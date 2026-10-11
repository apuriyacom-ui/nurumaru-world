(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const PAGE_SIZE = 12;
  const FAVORITES_KEY = 'nurumaru-favorites-v1';
  const MOTION_KEY = 'nurumaru-motion-v1';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const storage = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); }
      catch { /* Favorites remain available for this visit when storage is blocked. */ }
    }
  };
  const savedFavorites = storage.get(FAVORITES_KEY, []);
  const favorites = new Set(Array.isArray(savedFavorites) ? savedFavorites.map(String) : []);
  let characters = [];
  let activeFilter = 'all';
  let visibleLimit = PAGE_SIZE;
  let activeCharacter = null;
  let lastDialogTrigger = null;
  let motionPaused = storage.get(MOTION_KEY, reducedMotion.matches) === true;
  let story = null;

  function node(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined && content !== null) element.textContent = String(content);
    return element;
  }

  function textList(value) {
    return Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
  }

  function portrait(character, className, source = character.main, lazy = true) {
    const img = node('img', className);
    img.src = source;
    img.alt = character.name;
    img.decoding = 'async';
    if (lazy) img.loading = 'lazy';
    return img;
  }

  function numberLabel(character) {
    return `No.${String(character.number).padStart(3, '0')}`;
  }

  function setAccent(element, character) {
    if (/^#[\da-f]{3,8}$/i.test(character.color || '')) {
      element.style.setProperty('--character-color', character.color);
    }
  }

  function renderFavorite(button, character, withLabel = false) {
    const selected = favorites.has(character.id);
    button.classList.toggle('is-favorite', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-label', `${character.name}をお気に入り${selected ? 'から外す' : 'に追加'}`);
    button.textContent = withLabel
      ? selected ? '♥ お気に入りに登録済み' : '♡ お気に入りに追加'
      : selected ? '♥' : '♡';
  }

  function favoriteButton(character, withLabel = false) {
    const button = node('button', withLabel ? 'profile-favorite favorite-button' : 'favorite-button');
    button.type = 'button';
    button.dataset.favorite = character.id;
    renderFavorite(button, character, withLabel);
    button.addEventListener('click', () => {
      if (favorites.has(character.id)) favorites.delete(character.id);
      else favorites.add(character.id);
      storage.set(FAVORITES_KEY, [...favorites]);
      document.querySelectorAll('[data-favorite]').forEach((item) => {
        const match = characters.find((entry) => entry.id === item.dataset.favorite);
        if (match) renderFavorite(item, match, item.classList.contains('profile-favorite'));
      });
      if (activeFilter === 'favorites') renderCatalog();
    });
    return button;
  }

  function traitTags(character, className = 'character-traits', tag = 'div') {
    const list = node(tag, className);
    textList(character.traits).forEach((trait) => list.append(node('span', 'trait', trait)));
    return list;
  }

  function searchableText(character) {
    return [character.name, character.englishName, character.tagline, character.description,
      ...textList(character.traits), ...textList(character.temperament), ...textList(character.group)]
      .join(' ').normalize('NFKC').toLocaleLowerCase('ja');
  }

  function filteredCharacters() {
    const query = ($('search')?.value || '').trim().normalize('NFKC').toLocaleLowerCase('ja');
    const words = query.split(/\s+/).filter(Boolean);
    return characters.filter((character) => {
      const matchesFilter = activeFilter === 'all'
        || (activeFilter === 'favorites' ? favorites.has(character.id)
          : [...textList(character.temperament), ...textList(character.group), ...textList(character.traits)]
            .some((value) => value.includes(activeFilter)));
      return matchesFilter && words.every((word) => searchableText(character).includes(word));
    });
  }

  function card(character) {
    const article = node('article', 'character-card');
    article.dataset.number = character.number;
    setAccent(article, character);
    const open = node('button', 'card-open');
    open.type = 'button';
    open.dataset.character = character.id;
    open.setAttribute('aria-label', `${character.name}のプロフィールとスタンプを見る`);
    const art = node('span', 'character-art');
    art.append(portrait(character, 'character-image'));
    open.append(art, node('span', 'character-number', numberLabel(character)),
      node('span', 'character-name', character.name),
      node('span', 'character-tagline', character.tagline), traitTags(character, 'character-traits', 'span'));
    open.addEventListener('click', () => openCharacter(character, open));
    article.append(open, favoriteButton(character));
    return article;
  }

  function renderCatalog() {
    const grid = $('character-grid');
    if (!grid) return;
    const matches = filteredCharacters();
    const shown = matches.slice(0, visibleLimit);
    grid.replaceChildren(...shown.map(card));
    if ($('result-count')) $('result-count').textContent = `${matches.length}体のうち${shown.length}体を表示`;
    if ($('load-more')) $('load-more').hidden = shown.length >= matches.length;
    if ($('empty-state')) {
      $('empty-state').hidden = matches.length !== 0;
      $('empty-state').textContent = activeFilter === 'favorites'
        ? 'まだお気に入りがいません。気になる子の♡を押してみてね。'
        : 'ぴったりの仲間が見つかりませんでした。名前や性格を変えて探してみてね。';
    }
    $('filter-bar')?.querySelectorAll('[data-filter]').forEach((button) => {
      const active = button.dataset.filter === activeFilter;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('active', active);
      button.classList.toggle('is-active', active);
    });
  }

  function verifiedStoreUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') return null;
      if (url.hostname === 'store.line.me' && /^\/stickershop\/product\/\d+(?:\/|$)/.test(url.pathname)) return url.href;
      if (url.hostname === 'line.me' && /^\/S\/sticker\/\d+/.test(url.pathname)) return url.href;
    } catch { /* Invalid or non-store addresses are not shown. */ }
    return null;
  }

  function openCharacter(character, trigger) {
    const dialog = $('character-dialog');
    const content = $('dialog-content');
    if (!dialog || !content) return;
    activeCharacter = character;
    lastDialogTrigger = trigger || document.activeElement;
    const heading = node('div', 'profile-heading');
    setAccent(heading, character);
    const intro = node('div', 'profile-intro');
    const title = node('h2', 'profile-name', character.name);
    title.id = 'dialog-title';
    intro.append(node('p', 'eyebrow', `${numberLabel(character)} / ${character.englishName || 'NURUMARU FRIENDS'}`),
      title, node('p', 'profile-tagline', character.tagline),
      node('p', 'profile-description', character.description), traitTags(character));
    heading.append(portrait(character, 'profile-portrait', character.main, false), intro);
    const actions = node('div', 'profile-actions');
    actions.append(favoriteButton(character, true));
    const storeUrl = verifiedStoreUrl(character.storeUrl);
    if (storeUrl) {
      const link = node('a', 'button button-primary store-link', 'この子のスタンプを買う ↗');
      link.href = storeUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      actions.append(link);
    }
    const galleryTitle = node('h3', 'sticker-gallery-title', `${character.name}のスタンプ`);
    const gallery = node('div', 'sticker-gallery');
    (Array.isArray(character.stickers) ? character.stickers : []).forEach((sticker, index) => {
      const figure = node('figure', 'sticker-item');
      const num = String(sticker.number || index + 1).padStart(2, '0');
      const img = portrait(character, 'sticker-image', sticker.src);
      img.alt = `${character.name}のスタンプ${num}${sticker.caption ? `「${sticker.caption}」` : ''}`;
      figure.append(img, node('figcaption', 'sticker-caption', sticker.caption || num));
      gallery.append(figure);
    });
    content.replaceChildren(heading, actions, galleryTitle, gallery);
    dialog.setAttribute('aria-labelledby', 'dialog-title');
    if (!dialog.open) dialog.showModal();
    $('close-dialog')?.focus();
  }

  function renderHero() {
    const lead = characters.find((character) => character.name === 'ぬるまる') || characters[0];
    if (!lead) return;
    const target = $('featured-character');
    if (target?.tagName === 'IMG') {
      target.src = lead.main;
      target.alt = lead.name;
      target.decoding = 'async';
    } else if (target) target.replaceChildren(portrait(lead, 'hero-character-image', lead.main, false));
    const friends = $('hero-friends');
    if (friends) {
      const selected = ['ぷるり', 'もにょん', 'ぽてぴ'].map((name) => findCharacter(name));
      const unique = [...new Map(selected.map((character) => [character.id, character])).values()];
      for (const character of characters) {
        if (unique.length >= 3) break;
        if (character.id !== lead.id && !unique.some((item) => item.id === character.id)) unique.push(character);
      }
      friends.replaceChildren(...unique.slice(0, 3).map((character) => {
        const button = node('button', 'hero-friend');
        button.type = 'button';
        button.setAttribute('aria-label', `${character.name}に会う`);
        button.append(portrait(character, 'hero-friend-image', character.main, false));
        button.addEventListener('click', () => openCharacter(character, button));
        return button;
      }));
    }
    for (const id of ['total-count', 'character-count']) {
      if ($(id)) $(id).textContent = String(characters.length);
    }
    if ($('future-count')) $('future-count').textContent = '1,000';
  }

  function findCharacter(name, fallbackIndex = 0) {
    return characters.find((character) => character.name === name)
      || characters.find((character) => character.name.includes(name))
      || characters[fallbackIndex % characters.length];
  }

  function artFor(character, expression, fallbackIndex = 0) {
    const stickers = Array.isArray(character.stickers) ? character.stickers : [];
    const match = expression && stickers.find((sticker) => expression.test(sticker.caption || ''));
    return match?.src || stickers[fallbackIndex % (stickers.length || 1)]?.src || character.main;
  }

  function comicDefinitions() {
    const nuru = findCharacter('ぬるまる', 0);
    const puru = findCharacter('ぷるり', 1);
    const monyo = findCharacter('もにょん', 2);
    const pote = findCharacter('ぽてぴ', 3);
    const mame = findCharacter('まめぽ', 4);
    return [
      {
        title: '「ちょっと」の大きさ', summary: 'おやつは少し。気持ちは、だいぶ。',
        panels: [
          { character: nuru, speech: 'ひま〜。おやつ、ちょっと分けて〜', expression: /ひま/, note: 'おやつの時間' },
          { character: puru, speech: 'いいよ。ちょっとね。', expression: /いいよ|どうぞ|OK|了解/, note: 'ひとくち、おすそわけ' },
          { character: nuru, speech: 'わああ！ありがとおおお！！', expression: /ありがとう|やった|わくわく|嬉/, note: '喜びは、全力。', kind: 'celebrate' },
          { character: puru, speech: '喜びまで、ちょっとにして。', expression: /え|なに|なん|待|それ/, note: '声量は、ひと袋ぶん。' }
        ]
      },
      {
        title: 'おやすみの練習', summary: 'ちゃんと寝るために、ちゃんと起きている。',
        panels: [
          { character: pote, speech: '今日は早く寝るぞ〜', expression: /眠|ねむ|つかれ|おやすみ/, note: '今夜こそ、早寝' },
          { character: monyo, speech: 'まかせて。まずは練習！', expression: /まか|がんば|了解|OK/, note: '頼もしい友達' },
          { character: pote, speech: '……おやすみ。', expression: /おやすみ|眠|ねむ/, note: '上手に言えました' },
          { character: monyo, speech: 'いいね！あと49回！', expression: /やった|いい|ありがとう|わく/, note: '目が、覚めた。', kind: 'celebrate' }
        ]
      },
      {
        title: '了解を了解', summary: '仲良しすぎて、話が一歩も進まない。',
        panels: [
          { character: mame, speech: 'その「了解」、了解した！', expression: /了解|OK|まか/, note: '連絡は、ていねいに' },
          { character: nuru, speech: 'そうなんだ〜。じゃあ、その了解を了解！', expression: /そうなんだ/, note: '確認も、ていねいに' },
          { character: mame, speech: '了解の受け取りを確認しました。', expression: /ありがとう|どうも|おじぎ|了解/, note: 'ていねいが、大渋滞' },
          { character: nuru, speech: '……まだ何も頼んでない。', expression: /^なんのこと|^なにそれ/, note: '本題は、これから。' }
        ]
      }
    ];
  }

  function initializeComics() {
    const tabs = $('comic-tabs');
    const content = $('comic-content');
    if (!tabs || !content) return;
    const comics = comicDefinitions();
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', '4コマ漫画を選ぶ');
    content.setAttribute('role', 'tabpanel');
    content.tabIndex = 0;

    function selectComic(index, focus = false) {
      const comic = comics[index];
      tabs.querySelectorAll('[role="tab"]').forEach((tab, tabIndex) => {
        tab.setAttribute('aria-selected', String(tabIndex === index));
        tab.tabIndex = tabIndex === index ? 0 : -1;
        tab.classList.toggle('is-active', tabIndex === index);
        if (focus && tabIndex === index) tab.focus();
      });
      content.setAttribute('aria-labelledby', `comic-tab-${index}`);
      const intro = node('div', 'comic-intro');
      intro.append(node('h3', 'comic-title', comic.title), node('p', 'comic-summary', comic.summary));
      const panels = node('div', 'comic-grid');
      comic.panels.forEach((panel, panelIndex) => {
        const frame = node('article', `comic-panel${panel.kind ? ` comic-panel-${panel.kind}` : ''}`);
        setAccent(frame, panel.character);
        frame.setAttribute('aria-label', `${panelIndex + 1}コマ目`);
        frame.append(node('span', 'comic-panel-number', String(panelIndex + 1)),
          node('p', 'comic-speech', panel.speech),
          portrait(panel.character, 'comic-art', artFor(panel.character, panel.expression, panelIndex)),
          node('p', 'comic-speaker', panel.character.name),
          node('p', 'comic-note', panel.note));
        panels.append(frame);
      });
      content.replaceChildren(intro, panels);
    }

    tabs.replaceChildren(...comics.map((comic, index) => {
      const button = node('button', 'comic-tab', comic.title);
      button.type = 'button';
      button.id = `comic-tab-${index}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', 'comic-content');
      button.addEventListener('click', () => selectComic(index));
      button.addEventListener('keydown', (event) => {
        let next = index;
        if (event.key === 'ArrowRight') next = (index + 1) % comics.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + comics.length) % comics.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = comics.length - 1;
        else return;
        event.preventDefault();
        selectComic(next, true);
      });
      return button;
    }));
    selectComic(0);
  }

  function initializeStory() {
    const stage = $('animation-stage');
    const caption = $('animation-caption');
    const play = $('play-animation');
    const restart = $('restart-animation');
    if (!stage || !caption || !play || !restart) return;
    const cast = [findCharacter('ぬるまる', 0), findCharacter('ぷるり', 1), findCharacter('ぽてぴ', 3)];
    const scenes = [
      { at: 0, speaker: 0, text: 'おやつ、ひとつ見つけた。', caption: 'おやつ会議、開幕。', expression: /わく|やった|ありがとう/ },
      { at: 3, speaker: 1, text: 'どうぞ、どうぞ！', caption: '先に、どうぞ。', expression: /どうぞ|いいよ|OK|ありがとう/ },
      { at: 6, speaker: 2, text: 'そっちこそ、どうぞ！', caption: 'いえいえ、そちらこそ。', expression: /どうぞ|いいよ|OK|ありがとう/ },
      { at: 9, speaker: 0, text: 'では、お言葉に……', caption: 'ようやく、いただきます？', expression: /わく|やった|了解|OK/ },
      { at: 12, speaker: -1, text: '…………。', caption: 'みんな、めっちゃ見てる。', expression: /^なんのこと|^なにそれ/ },
      { at: 15, speaker: 0, text: 'やっぱ、さんぶんこしよ。', caption: '結論：いっしょがおいしい。', expression: /好き|ありがとう|やった/, ending: true }
    ];
    const duration = 18;
    const castElement = node('div', 'story-cast');
    const actors = cast.map((character, index) => {
      const actor = node('div', 'story-actor');
      actor.dataset.actor = String(index);
      setAccent(actor, character);
      actor.append(portrait(character, 'story-character', character.main, false), node('span', 'story-name', character.name));
      castElement.append(actor);
      return actor;
    });
    const bubble = node('p', 'story-bubble');
    const snack = node('div', 'story-snack');
    snack.setAttribute('aria-label', 'みんなで分けるおやつ');
    for (let i = 0; i < 3; i++) snack.append(node('span', 'snack-piece'));
    const progress = node('div', 'story-progress');
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-label', 'アニメーションの進行');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', String(duration));
    const progressBar = node('span', 'story-progress-bar');
    progress.append(progressBar);
    stage.replaceChildren(node('span', 'story-scene-label', 'おやつ会議'), bubble, castElement, snack, progress);
    caption.setAttribute('aria-live', 'polite');
    let elapsed = 0;
    let startedAt = 0;
    let frameId = 0;
    let playing = false;
    let sceneIndex = -1;

    function updateScene(force = false) {
      const next = scenes.reduce((result, scene, index) => elapsed >= scene.at ? index : result, 0);
      if (next !== sceneIndex || force) {
        sceneIndex = next;
        const scene = scenes[next];
        stage.dataset.scene = String(next);
        stage.classList.toggle('story-ending', !!scene.ending);
        bubble.textContent = scene.text;
        bubble.dataset.speaker = String(scene.speaker);
        caption.textContent = scene.caption;
        actors.forEach((actor, index) => {
          actor.classList.toggle('is-speaking', index === scene.speaker || scene.speaker === -1);
          actor.classList.toggle('is-watching', scene.speaker !== -1 && index !== scene.speaker);
          const image = actor.querySelector('img');
          // Text-free portraits keep onlookers from saying a second, unrelated line.
          if (index > 0) image.src = cast[index].main;
          else if (scene.speaker === 0 || scene.speaker === -1) image.src = artFor(cast[index], scene.expression, next);
        });
      }
      progressBar.style.width = `${Math.min(100, elapsed / duration * 100)}%`;
      progress.setAttribute('aria-valuenow', String(Math.min(duration, Math.floor(elapsed))));
      progress.setAttribute('aria-valuetext', `${Math.floor(elapsed)}秒 / ${duration}秒`);
    }

    function updateControls() {
      play.textContent = playing ? '一時停止' : elapsed >= duration ? 'もう一度再生' : elapsed > 0 ? '続きから再生' : 'アニメを再生';
      play.setAttribute('aria-pressed', String(playing));
      stage.classList.toggle('is-playing', playing);
      stage.classList.toggle('is-paused', !playing);
    }

    function pause() {
      if (!playing) return;
      elapsed = Math.min(duration, (performance.now() - startedAt) / 1000);
      playing = false;
      cancelAnimationFrame(frameId);
      updateScene();
      updateControls();
    }

    function tick(now) {
      if (!playing) return;
      elapsed = Math.min(duration, (now - startedAt) / 1000);
      updateScene();
      if (elapsed >= duration) {
        playing = false;
        updateControls();
        return;
      }
      frameId = requestAnimationFrame(tick);
    }

    function start() {
      if (elapsed >= duration) { elapsed = 0; sceneIndex = -1; }
      if (motionPaused) setMotion(false);
      startedAt = performance.now() - elapsed * 1000;
      playing = true;
      updateScene();
      updateControls();
      frameId = requestAnimationFrame(tick);
    }

    play.addEventListener('click', () => playing ? pause() : start());
    restart.addEventListener('click', () => {
      pause();
      elapsed = 0;
      sceneIndex = -1;
      updateScene();
      start();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
    updateScene(true);
    updateControls();
    story = { pause };
  }

  function setMotion(paused, persist = true) {
    motionPaused = paused;
    document.documentElement.classList.toggle('motion-paused', paused);
    document.documentElement.dataset.motion = paused ? 'paused' : 'running';
    const button = $('motion-toggle');
    if (button) {
      button.textContent = paused ? '動きを楽しむ' : '動きを止める';
      button.setAttribute('aria-pressed', String(!paused));
      button.setAttribute('aria-label', paused ? 'ページの動きを有効にする' : 'ページの動きを止める');
    }
    if (paused) story?.pause();
    if (persist) storage.set(MOTION_KEY, paused);
  }

  function initializeEvents() {
    let searchTimer;
    $('search')?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { visibleLimit = PAGE_SIZE; renderCatalog(); }, 100);
    });
    $('filter-bar')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-filter]');
      if (!button || !$('filter-bar').contains(button)) return;
      activeFilter = button.dataset.filter;
      visibleLimit = PAGE_SIZE;
      renderCatalog();
    });
    $('load-more')?.addEventListener('click', () => {
      const firstNew = visibleLimit;
      visibleLimit += PAGE_SIZE;
      renderCatalog();
      $('character-grid')?.querySelectorAll('[data-character]')[firstNew]?.focus({ preventScroll: true });
    });
    $('meet-random')?.addEventListener('click', (event) => {
      if (characters.length) openCharacter(characters[Math.floor(Math.random() * characters.length)], event.currentTarget);
    });
    $('close-dialog')?.addEventListener('click', () => $('character-dialog').close());
    $('character-dialog')?.addEventListener('click', (event) => {
      const dialog = $('character-dialog');
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
    $('character-dialog')?.addEventListener('close', () => {
      activeCharacter = null;
      if (lastDialogTrigger?.isConnected) lastDialogTrigger.focus({ preventScroll: true });
      else $('search')?.focus({ preventScroll: true });
    });
    $('motion-toggle')?.addEventListener('click', () => setMotion(!motionPaused));
    reducedMotion.addEventListener('change', (event) => { if (event.matches) setMotion(true); });
    setMotion(motionPaused, false);
  }

  async function initialize() {
    initializeEvents();
    try {
      const response = await fetch('data/characters.json');
      if (!response.ok) throw new Error(`Character data could not be loaded (${response.status}).`);
      const data = await response.json();
      if (!Array.isArray(data) || !data.length) throw new Error('Character data is empty.');
      characters = data.map((character, index) => ({
        ...character,
        id: String(character.id ?? `friend-${index + 1}`),
        number: character.number ?? index + 1,
        name: String(character.name || `仲間 ${index + 1}`),
        traits: textList(character.traits),
        stickers: Array.isArray(character.stickers) ? character.stickers : []
      }));
      renderHero();
      renderCatalog();
      initializeComics();
      initializeStory();
      document.documentElement.classList.add('is-ready');
    } catch (error) {
      if ($('result-count')) $('result-count').textContent = '仲間の情報を読み込めませんでした';
      if ($('empty-state')) {
        $('empty-state').hidden = false;
        $('empty-state').textContent = '通信を確認して、ページを再読み込みしてください。';
      }
      if ($('load-more')) $('load-more').hidden = true;
      console.error(error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
