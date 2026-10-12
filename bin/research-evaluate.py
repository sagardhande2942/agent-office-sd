"""External adapter. Discovery source and installed strategy files are never changed."""
import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import runpy
import re
import sys
import tempfile


def main():
    request = json.loads(base64.b64decode(sys.argv[1]))
    # Only the existing deterministic evaluator is imported. No generation manager,
    # model registry, concept judge, embeddings, or refinement stage is invoked.
    from discovery.strategy_validator import validate_strategy_code
    result = validate_strategy_code(request['code'])
    if not result.is_valid:
        raise ValueError('Strategy validation failed: ' + '; '.join(result.errors))
    with tempfile.TemporaryDirectory(prefix='office-research-') as directory:
        root = pathlib.Path(directory)
        code_path = root / 'strategy.py'
        config_path = root / 'strategy.cfg'
        code_path.write_text(request['code'], encoding='utf-8')
        config_path.write_text(request['config'], encoding='utf-8')
        # Install only into this subprocess's import table. Runner resolves its
        # usual general strategy module, without installing into Tradeai's tree.
        name = 'strategies.mock_strats.general.' + request['strategy']
        spec = importlib.util.spec_from_file_location(name, code_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        # Keep strategy import diagnostics away from evaluator result markers.
        with contextlib.redirect_stdout(sys.stderr):
            spec.loader.exec_module(module)
        brief = request['brief']
        # Record actual data hashes separately from the user's dataset label.
        import root_ai
        trade_root = pathlib.Path(root_ai.__file__).parent
        fingerprints = {}
        for symbol in brief['symbols']:
            for relative in ['mock_server/forex_data', 'forex_data']:
                source = trade_root / relative / symbol / (symbol + '_' + brief['timeframe'] + '.csv')
                if source.is_file():
                    digest = hashlib.sha256()
                    with source.open('rb') as stream:
                        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                            digest.update(chunk)
                    fingerprints[symbol] = {'path': str(source), 'sha256': digest.hexdigest()}
                    break
        print('===OFFICE_DATASET_JSON===')
        print(json.dumps(fingerprints))
        print('===END_OFFICE_DATASET_JSON===')
        phases = []
        class Capture(io.StringIO):
            def write(self, text):
                if self.tell() + len(text) > 8_000_000:
                    raise ValueError('Evaluator exceeded output limit')
                sys.__stdout__.write(text)
                return super().write(text)
        for phase in (['quick_filter', 'walk_forward'] if brief['walkForward'] else ['quick_filter']):
            sys.argv = ['discovery.evaluate_strategy', '--strategy-name', request['strategy'],
                        '--cfg-file', str(config_path), '--phase', phase,
                        '--symbols', *brief['symbols'], '--start-time', brief['start'],
                        '--end-time', brief['end'], '--timeframe', brief['timeframe'],
                        '--prefilter-days', '0']
            captured = Capture()
            with contextlib.redirect_stdout(captured):
                runpy.run_module('discovery.evaluate_strategy', run_name='__main__')
            found = re.findall(r'===DISCOVERY_RESULT_JSON===\s*(.*?)\s*===END_DISCOVERY_RESULT_JSON===', captured.getvalue(), re.S)
            if not found:
                raise ValueError('Evaluator returned no result evidence for ' + phase)
            phases.extend(json.loads(value) for value in found)
        # OrcaTrex compacts logs to the last structured block. Preserve all phases
        # and data fingerprints together, rather than losing the first phase.
        print('===WORKER_RESULT_JSON===')
        print(json.dumps({'phases': phases, 'datasetFingerprints': fingerprints,
                          'promotionStatus': 'RESEARCH',
                          'note': 'Development evaluation only; no final promotion.'}))
        print('===END_WORKER_RESULT_JSON===')


if __name__ == '__main__':
    main()
