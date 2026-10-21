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
  let lastDialogTrigger = null;
  let motionPaused = storage.get(MOTION_KEY, reducedMotion.matches) === true;

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
      $('empty-state').textContent = activeFilter === 'favorites' && favorites.size === 0
        ? 'まだお気に入りがいません。気になる子の♡を押してみてね。'
        : '仲間が見つかりませんでした。検索する言葉を変えるか、絞り込みを解除してみてね。';
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
    if (character.availability === 'coming-soon') actions.append(node('p', 'store-note', 'LINEスタンプは審査待ちです。販売開始をお楽しみに！'));
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
    for (const id of ['total-count', 'character-count', 'catalog-total']) {
      if ($(id)) $(id).textContent = String(characters.length);
    }
    if ($('future-count')) $('future-count').textContent = '1,000';
  }

  function findCharacter(name, fallbackIndex = 0) {
    return characters.find((character) => character.name === name)
      || characters.find((character) => character.name.includes(name))
      || characters[fallbackIndex % characters.length];
  }

  function renderNewFriends() {
    const grid = $('new-friends-grid');
    if (!grid) return;
    const newest = characters
      .filter((character) => character.releasedAsNew === true)
      .sort((a, b) => Number(b.number) - Number(a.number))
      .slice(0, 4);
    grid.replaceChildren(...newest.map(card));
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
      const response = await fetch('data/characters.json?v=20261021-update1');
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
      renderNewFriends();
      renderCatalog();
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
