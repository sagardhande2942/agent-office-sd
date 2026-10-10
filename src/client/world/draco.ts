import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import decoderJsUrl from 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url';
import decoderWasmUrl from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url';

/** Bundle the matching Three.js decoder locally; workers and WASM load only for compressed models. */
export const dracoDecoder = new DRACOLoader().setDecoderPath({ js: decoderJsUrl, wasm: decoderWasmUrl });
