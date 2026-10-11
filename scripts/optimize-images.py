"""Create high-quality transparent WebP assets from approved PNGs.

Requires Pillow. PNG sources are never changed or deleted. Character catalog
paths are updated only after size and alpha-channel validation. Lossless mode
also verifies visible RGBA pixels. Web copies never replace original artwork.
"""
from pathlib import Path
import argparse
import json
from concurrent.futures import ThreadPoolExecutor
from PIL import Image


def convert(path, quality=92, lossless=False):
    destination = path.with_suffix('.webp')
    with Image.open(path) as source:
        rgba = source.convert('RGBA')
        reusable = False
        if lossless and destination.exists() and destination.stat().st_size:
            try:
                with Image.open(destination) as previous:
                    reusable = previous.size == rgba.size and previous.convert('RGBA').tobytes() == rgba.tobytes()
            except OSError:
                pass
        if not reusable:
            rgba.save(destination, 'WEBP', lossless=lossless, quality=100 if lossless else quality, method=6, exact=True, alpha_quality=100)
        with Image.open(destination) as converted:
            webp = converted.convert('RGBA')
            if webp.size != rgba.size or webp.getchannel('A').tobytes() != rgba.getchannel('A').tobytes():
                raise RuntimeError(f'Dimension or alpha mismatch: {path.name}')
            if not lossless:
                match = 'same-dimensions-and-alpha-high-quality-rgb'
            elif webp.tobytes() != rgba.tobytes():
                # RGB under alpha=0 cannot affect visible pixels. Older
                # Pillow/libwebp versions may discard that hidden RGB data.
                a = Image.new('RGBA', rgba.size)
                b = Image.new('RGBA', webp.size)
                a.alpha_composite(rgba)
                b.alpha_composite(webp)
                if a.size != b.size or a.tobytes() != b.tobytes():
                    raise RuntimeError(f'Visible pixel mismatch: {path.name}')
                match = 'visible-rgba'
            else:
                match = 'exact-rgba'
    return {'path': destination, 'sourceBytes': path.stat().st_size, 'webpBytes': destination.stat().st_size, 'pixelMatch': match}


def optimize(source_root, catalog=None, report=None, workers=4, quality=92, lossless=False):
    images = sorted(source_root.rglob('*.png'))
    if not images:
        raise SystemExit(f'No PNG images found in {source_root}')
    results=[]
    with ThreadPoolExecutor(max_workers=workers) as executor:
        for result in executor.map(lambda p: convert(p,quality,lossless),images):
            result['file'] = str(result.pop('path').relative_to(source_root))
            results.append(result)
    before=sum(row['sourceBytes'] for row in results)
    after=sum(row['webpBytes'] for row in results)
    if catalog:
        data = json.loads(catalog.read_text(encoding='utf-8-sig'))
        for character in data:
            character['main'] = str(Path(character['main']).with_suffix('.webp')).replace('\\', '/')
            for sticker in character['stickers']:
                sticker['src'] = str(Path(sticker['src']).with_suffix('.webp')).replace('\\', '/')
        catalog.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    summary = {
        'files': len(images), 'pngBytes': before, 'webpBytes': after,
        'savedPercent': round((1-after/before)*100, 2),
        'exactRgbaMatches': sum(row['pixelMatch']=='exact-rgba' for row in results),
        'mode': 'lossless' if lossless else 'high-quality-webp',
        'quality': 100 if lossless else quality,
        'verifiedDimensionsAndAlpha': len(results),
        'projected1000CharacterBytes': round(after / (len(images)/17) * 1000),
        'allPngSourcesPreserved': True,
        'images': results,
    }
    if report:
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: value for key, value in summary.items() if key != 'images'}))


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', nargs='?', type=Path, default=root/'assets/characters', help='Character PNG directory; searches subdirectories')
    parser.add_argument('--catalog', type=Path, default=root/'data/characters.json', help='Character catalog to update')
    parser.add_argument('--report', type=Path, default=root/'inventory/webp-validation.json', help='Local validation report, excluded from publication')
    parser.add_argument('--workers', type=int, default=4, help='Number of concurrent image encoders')
    parser.add_argument('--quality', type=int, default=92, help='RGB WebP quality, 1..100')
    parser.add_argument('--lossless', action='store_true', help='Preserve visible pixels exactly; produces larger web assets')
    args = parser.parse_args()
    optimize(args.folder.resolve(), args.catalog.resolve(), args.report.resolve(), max(1,args.workers),max(1,min(100,args.quality)),args.lossless)
