"""Read-only integration proof using real Discovery and isolated synthetic data.

Run with Tradeai's Python environment:
  python scripts/prove-discovery-adapter.py --tradeai /path/to/Tradeai
"""
import argparse
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

CODE = '''from strategies.utils.mock_strategy_base import MockStrategyBase
from strategies.utils.order_handler import ExnessOrderHandler
class Strategy(MockStrategyBase):
    def __init__(self, strat_name, strat_id, quiet_mode=False):
        self.symbol = strat_id.split('.')[0]
        super().__init__(strat_name, strat_id, self.symbol, quiet_mode=quiet_mode)
        self.load_config_variables()
        self.order_handler = ExnessOrderHandler()
        self.is_active = True
        self.init_md()
    def trade(self, trade_dict=None):
        return trade_dict
'''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tradeai', required=True)
    args = parser.parse_args()
    tradeai = Path(args.tradeai).resolve()
    evaluator = tradeai / 'discovery/evaluate_strategy.py'
    before = hashlib.sha256(evaluator.read_bytes()).hexdigest()
    script = Path(__file__).resolve().parents[1] / 'bin/research-evaluate.py'
    with tempfile.TemporaryDirectory(prefix='discovery-adapter-proof-') as directory:
        root = Path(directory)
        # root_ai relocates runtime data/config paths while source packages are
        # imported from the existing checkout. No installed strategies are copied.
        (root / 'root_ai.py').write_text('', encoding='utf-8')
        config_dir = root / 'strategies/config'
        config_dir.mkdir(parents=True)
        (config_dir / 'all_pairs.cfg').write_bytes((tradeai / 'strategies/config/all_pairs.cfg').read_bytes())
        # Runner fingerprints these source paths under ROOT_PATH. Supply copies
        # for provenance while imports continue to use the existing checkout.
        for relative in ['mock_server/runner.py', 'mock_server/utils/mock_executor_base.py',
                         'mock_server/utils/trade_history_wrapper.py', 'strategies/utils/strategy_base.py',
                         'trade_python/utils/candles.py', 'trade_python/utils/numeric_candles.py', 'rms/risk_management.py']:
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((tradeai / relative).read_bytes())
        data_dir = root / 'mock_server/forex_data/EURUSD'
        data_dir.mkdir(parents=True)
        bars = ['date,open,high,low,close,volume']
        for i in range(5760):
            timestamp = datetime.datetime(2023, 12, 30) + datetime.timedelta(minutes=i)
            bars.append(f'{timestamp:%Y-%m-%d %H:%M:%S},1.1,1.101,1.099,1.1,1')
        (data_dir / 'EURUSD_M1.csv').write_text('\n'.join(bars), encoding='utf-8')
        # This proof fails if the deterministic execution path attempts network
        # access or imports an AI provider. It is not a production sandbox.
        (root / 'sitecustomize.py').write_text('''import builtins, socket
original = builtins.__import__
def checked(name, *args, **kwargs):
    if name.split('.')[0] in {'openai', 'anthropic'} or name.startswith('google.generativeai') or name == 'discovery.llm_provider':
        raise RuntimeError('Unexpected AI provider import: ' + name)
    return original(name, *args, **kwargs)
builtins.__import__ = checked
def blocked(*args, **kwargs):
    raise RuntimeError('Network disabled for adapter integration proof')
socket.socket.connect = blocked
socket.create_connection = blocked
''', encoding='utf-8')
        config = json.loads(next((tradeai / 'strategies/mock_config/EURUSD').glob('*.cfg')).read_text())
        config['config']['account_id'] = 'office_adapter_proof'
        config['config']['md_symbols'] = {'EURUSD': {'timeframes': ['1M'], 'max_candles': [10]}}
        payload = base64.b64encode(json.dumps({'strategy': 'office_adapter_proof', 'code': CODE, 'config': json.dumps(config),
            'brief': {'symbols': ['EURUSD'], 'timeframe': 'M1', 'start': '20240101', 'end': '20240103', 'walkForward': False}}).encode()).decode()
        env = dict(os.environ, PYTHONPATH=str(root) + os.pathsep + str(tradeai), PYTHONDONTWRITEBYTECODE='1', PYTHONIOENCODING='utf-8')
        import sys
        result = subprocess.run([sys.executable, str(script), payload], cwd=root, env=env, capture_output=True, text=True, timeout=120)
        if result.returncode:
            raise RuntimeError(result.stderr[-6000:] + '\n' + result.stdout[-2000:])
        marker = '===DISCOVERY_RESULT_JSON==='
        metrics = json.loads(result.stdout.split(marker)[-1].split('===END_DISCOVERY_RESULT_JSON===')[0])
        if metrics.get('error') or not metrics.get('engine_version'):
            raise RuntimeError('Evaluator failed: ' + str(metrics.get('error') or metrics.get('outcome_status')))
        assert hashlib.sha256(evaluator.read_bytes()).hexdigest() == before
        print(json.dumps({'status': 'passed', 'engine_version': metrics['engine_version'], 'total_trades': metrics['total_trades'],
            'paid_ai': False, 'network_access': False, 'discovery_source_unchanged': True, 'dataset': 'isolated synthetic EURUSD bars'}, indent=2))


if __name__ == '__main__':
    main()
