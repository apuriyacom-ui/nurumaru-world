import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixedFiles = new Set([
  'index.html', 'styles.css', 'components.css', 'app.js', '.nojekyll',
  '.gitignore', 'README.md', 'assets/favicon.png', 'assets/og-image.png'
]);
const permitted = relative => fixedFiles.has(relative)
  || /^data\/[^/]+\.json$/.test(relative)
  || /^assets\/(?:[^/]+\/)*[^/]+\.webp$/.test(relative)
  || /^scripts\/[^/]+\.(?:py|mjs)$/.test(relative);

function collect(directory, prefix = '') {
  const result = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = `${prefix}${item.name}`;
    const absolute = path.join(directory, item.name);
    if (item.isSymbolicLink()) {
      if (permitted(relative)) throw new Error(`公開対象にシンボリックリンクがあります: ${relative}`);
      continue;
    }
    if (item.isDirectory()) {
      if (!prefix && !['assets', 'data', 'scripts'].includes(item.name)) continue;
      // Data and maintenance scripts are intentionally top-level files only.
      if (prefix === 'data/' || prefix === 'scripts/') continue;
      result.push(...collect(absolute, `${relative}/`));
    } else if (item.isFile() && permitted(relative)) result.push(relative);
  }
  return result;
}

function preflight(files) {
  const included = new Set(files);
  for (const required of fixedFiles) {
    if (!included.has(required)) throw new Error(`公開に必要なファイルがありません: ${required}`);
  }
  execFileSync(process.execPath, [path.join(root, 'scripts/validate.mjs')], { cwd: root, stdio: 'inherit' });
  const characters = JSON.parse(fs.readFileSync(path.join(root, 'data/characters.json'), 'utf8'));
  for (const character of characters) {
    for (const asset of [character.main, ...character.stickers.map(sticker => sticker.src)]) {
      if (!included.has(asset)) throw new Error(`図鑑の画像がZIPに含まれません。WebP変換を確認してください: ${asset}`);
    }
  }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const [, value] of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) continue;
    const relative = value.split(/[?#]/)[0].replace(/^\.\//, '');
    if (relative && !included.has(relative)) throw new Error(`HTMLの参照先がZIPに含まれません: ${value}`);
  }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function createZip(files, destination) {
  if (files.length > 65535) throw new Error('ZIPのファイル数上限を超えています。');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  const centralDirectory = [];
  let offset = 0;
  let sourceBytes = 0;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx');
    const write = bytes => {
      let written = 0;
      while (written < bytes.length) written += fs.writeSync(descriptor, bytes, written, bytes.length - written);
      offset += bytes.length;
      if (offset > 0xffffffff) throw new Error('ZIP64が必要なサイズです。公開画像を軽量化してください。');
    };
    for (const relative of files) {
      const name = Buffer.from(relative, 'utf8');
      const data = fs.readFileSync(path.join(root, relative));
      const compressed = deflateRawSync(data, { level: 9 });
      const checksum = crc32(data);
      sourceBytes += data.length;
      const localOffset = offset;
      // UTF-8 names, DEFLATE, fixed 1980-01-01 date: reproducible archives.
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6);
      local.writeUInt16LE(8, 8);
      local.writeUInt16LE(0x0021, 12);
      local.writeUInt32LE(checksum, 14);
      local.writeUInt32LE(compressed.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(name.length, 26);
      write(local); write(name); write(compressed);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      local.copy(central, 6, 4, 30);
      central.writeUInt32LE(localOffset, 42);
      centralDirectory.push(central, name);
    }
    const centralOffset = offset;
    for (const part of centralDirectory) write(part);
    const centralSize = offset - centralOffset;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(centralOffset, 16);
    write(end);
    fs.closeSync(descriptor); descriptor = undefined;
    fs.renameSync(temporary, destination);
    return { files: files.length, sourceBytes, zipBytes: offset, archive: destination };
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch { /* No partially written archive to remove. */ }
    throw error;
  }
}

try {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output');
  const checkOnly = args.includes('--check');
  const allowedArguments = new Set(['--check', '--output']);
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--output') {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('--output の後に保存先を指定してください。');
      index++;
    } else if (!allowedArguments.has(args[index])) throw new Error(`不明な引数です: ${args[index]}`);
  }
  const destination = outputIndex >= 0
    ? path.resolve(process.cwd(), args[outputIndex + 1])
    : path.join(path.dirname(root), 'nurumaru-website-public.zip');
  if (path.extname(destination).toLowerCase() !== '.zip') throw new Error('保存先の拡張子は .zip にしてください。');
  if (permitted(path.relative(root, destination).replaceAll(path.sep, '/'))) throw new Error('保存先が公開ファイルと重複しています。');
  const files = collect(root).sort();
  preflight(files);
  if (checkOnly) console.log(JSON.stringify({ check: 'passed', files: files.length, archive: destination }));
  else console.log(JSON.stringify(createZip(files, destination)));
} catch (error) {
  console.error(`公開用ZIPの作成を中止しました: ${error.message}`);
  process.exitCode = 1;
}
