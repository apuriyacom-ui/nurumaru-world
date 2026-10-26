import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const characters = JSON.parse(fs.readFileSync(path.join(root, 'data/characters.json'), 'utf8'));
const errors = [];
const ids = new Set(), numbers = new Set(), assets = new Set();
const fail = message => errors.push(message);
if (!Array.isArray(characters) || !characters.length || characters.length > 1000) fail('キャラクター数は1〜1000体にしてください。');
const asset = (relative, owner) => {
  if (typeof relative !== 'string' || !/^assets\/characters(?:-en)?\/[a-z0-9-]+\/(main|\d{2})\.(png|webp)$/.test(relative)) return fail(`${owner}: 画像パスが不正です。`);
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(root + path.sep) || !fs.existsSync(absolute)) return fail(`${owner}: ${relative} が見つかりません。`);
  const image = fs.readFileSync(absolute);
  const png = image.subarray(0,8).toString('hex') === '89504e470d0a1a0a';
  const webp = image.subarray(0,4).toString() === 'RIFF' && image.subarray(8,12).toString() === 'WEBP';
  if (!png && !webp) fail(`${owner}: PNG/WebP形式ではありません。`);
  assets.add(relative);
};
for (const c of characters) {
  if (!/^[a-z0-9-]+$/.test(c.id) || ids.has(c.id)) fail(`IDが不正または重複: ${c.id}`);
  ids.add(c.id);
  if (!Number.isInteger(c.number) || c.number < 1 || c.number > 1000 || numbers.has(c.number)) fail(`図鑑番号が不正または重複: ${c.number}`);
  numbers.add(c.number);
  for (const key of ['name', 'englishName', 'tagline', 'description']) if (typeof c[key] !== 'string' || !c[key].trim()) fail(`${c.id}: ${key}を入力してください。`);
  if (!['おっとり', 'にぎやか', 'ふしぎ'].includes(c.temperament)) fail(`${c.id}: temperamentが不正です。`);
  if (!/^#[0-9a-f]{6}$/i.test(c.color)) fail(`${c.id}: colorは6桁のカラーコードにしてください。`);
  if (!Array.isArray(c.traits) || !c.traits.length || c.traits.some(t => typeof t !== 'string')) fail(`${c.id}: traitsが不正です。`);
  asset(c.main, c.id);
  if (!Array.isArray(c.stickers) || c.stickers.length !== 16) fail(`${c.id}: スタンプは16枚必要です。`);
  const stickerNumbers = new Set();
  for (const s of c.stickers || []) {
    if (!Number.isInteger(s.number) || s.number < 1 || s.number > 16 || stickerNumbers.has(s.number)) fail(`${c.id}: スタンプ番号が不正です。`);
    stickerNumbers.add(s.number);
    if (typeof s.caption !== 'string' || !s.caption.trim()) fail(`${c.id}: セリフを入力してください。`);
    asset(s.src, c.id);
  }
  if (c.storeUrl && !/^https:\/\/store\.line\.me\/stickershop\/product\/\d+\/ja\/?$/.test(c.storeUrl)) fail(`${c.id}: 販売用のLINE STORE URLを確認してください。`);
  if (/はなちゃん|イケボパンマン|関西弁/.test(c.name)) fail(`対象外の作品が含まれています: ${c.name}`);
}
for (const file of ['index.html', 'styles.css', 'components.css', 'app.js', '.nojekyll']) if (!fs.existsSync(path.join(root, file))) fail(`${file}がありません。`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log(`確認完了: ${characters.length}体、${assets.size}画像、販売リンク${characters.filter(c=>c.storeUrl).length}件。1,000体までのデータ形式を満たしています。`);
