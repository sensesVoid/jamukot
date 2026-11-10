import { OggOpusDecoder } from './node_modules/ogg-opus-decoder/index.js';
import { readFileSync } from 'node:fs';

const decoder = new OggOpusDecoder();
await decoder.ready;
const data = readFileSync('audio/1.opus');
console.log('file size:', data.length);
const result = await decoder.decodeFile(new Uint8Array(data));
console.log('channels:', result.channelData.length);
console.log('samples:', result.samplesDecoded);
console.log('sampleRate:', result.sampleRate);
console.log('errors:', result.errors);
decoder.free();
