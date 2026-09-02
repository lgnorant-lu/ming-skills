import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';

export const gzipAsync = promisify(gzip);
export const gunzipAsync = promisify(gunzip);
