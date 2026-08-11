import { chmod, copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve("node_modules/ffmpeg-static/ffmpeg");
const destination = resolve(".output/server/_libs/ffmpeg");

await mkdir(resolve(".output/server/_libs"), { recursive: true });
await copyFile(source, destination);
await chmod(destination, 0o755);
