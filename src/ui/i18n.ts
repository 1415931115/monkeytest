/**
 * Tiny i18n layer. English is the default locale; the original Chinese copy lives on as `zh`.
 *
 * - `t(key, params)` looks up a string and fills `{name}` placeholders.
 * - Static DOM nodes opt in with `data-i18n` (textContent), `data-i18n-html` (trusted markup
 *   from the tables below), `data-i18n-aria` (aria-label) and `data-i18n-title` (title).
 * - The choice persists in localStorage under `monkeybro.lang`.
 *
 * Art lock: the Caller's call stays the Chinese 「猴哥——」 in every locale.
 */
export type Lang = 'en' | 'zh';

const LANG_KEY = 'monkeybro.lang';

const en = {
  'meta.title': 'Peach Heist Eve · 猴哥 MONKEYBRO',
  'meta.canvas': 'First-person view of the moonlit immortal peach orchard',
  'aria.compass': 'Compass',
  'aria.satchel': 'Satchel',

  'lang.button': 'Language · English',

  'zone.glyph.0': 'I',
  'zone.glyph.1': 'II',
  'zone.glyph.2': 'III',
  'zone.name.0': 'Outer Orchard · Moonlit Peach Path',
  'zone.name.1': 'Mist Grove · Gauze-Veiled Maze',
  'zone.name.2': 'Orchard Heart · The Mother Tree',
  objective: 'Pick peaches · Find the cold-blue gate home',

  'meter.health': 'Life-fire',
  'meter.stamina': 'Stamina',
  'meter.battery': 'Lantern oil',
  'meter.healthShort': 'HP',
  'meter.staminaShort': 'STA',
  'meter.batteryShort': 'OIL',
  'light.on': 'LIT',
  'light.off': 'DARK',

  'tier.short.0': '10 yr',
  'tier.short.1': '100 yr',
  'tier.short.2': '1k yr',
  'tier.short.3': '10k yr',
  'tier.name.0': 'Decade Peach',
  'tier.name.1': 'Century Peach',
  'tier.name.2': 'Millennium Peach',
  'tier.name.3': 'Myriad-Year Immortal Peach',
  'satchel.haul': 'Haul',

  'prompt.default': 'Hold to pick',
  'prompt.hold': 'Hold to pick the {tier}',
  'prompt.picking': 'Picking the {tier}…',
  'prompt.keyTouch': 'Hold',
  'hunt.meter': "JinQue's Siege · The whole orchard hunts",
  'lock.hint': 'Click the screen to lock the view',
  'extract.label': 'Escaping…',
  'compass.n': 'N',
  'compass.e': 'E',
  'compass.s': 'S',
  'compass.w': 'W',
  'compass.home': 'EXIT',

  'title.h1': 'Peach Heist Eve',
  'title.tagline': 'MONKEYBRO · A night raid on the immortal peach orchard',
  'title.rule.peach': '<b>Steal immortal peaches.</b> The older the peach, the brighter it glows and the more it is worth — decade, century, millennium, myriad-year.',
  'title.rule.shrine': '<b>Find the cold-blue stone gate home.</b> Two of them light up each night. Your haul only counts if you escape.',
  'title.rule.zimo': '<b>ZiMo</b> follows light and sound. One grasp tears away half your life-fire — your lantern beam drives her back.',
  'title.rule.qingluan': '<b>QingLuan:</b> if someone calls 「猴哥——」 (“Monkey Bro—”) behind you while you pick, do NOT look back.',
  'title.rule.jinque': '<b>JinQue:</b> pick a millennium or myriad-year peach and she wakes every fairy-demon in the orchard to hunt you.',
  'title.start': 'Enter the Orchard',
  'title.controls':
    '<kbd>WASD</kbd> move <kbd>Mouse</kbd> look <kbd>Shift</kbd> sprint <kbd>F</kbd> lantern <kbd>E</kbd>/<kbd>LMB</kbd> hold to pick <kbd>Esc</kbd> pause',
  'title.best': 'Best haul: {n}',

  'pause.title': 'Paused',
  'pause.flavor': 'The orchard waits. It is very patient.',
  'pause.resume': 'Resume',
  'pause.soundOn': 'Sound · On',
  'pause.soundOff': 'Sound · Off',
  'pause.restart': 'New Night',

  'dead.glyph': '✕',
  'dead.title': 'You answered the call',
  'dead.retry': 'Enter Again',
  'dead.lost': 'Peach value lost: {n}',
  'dead.empty': 'Your hands were empty.',
  'death.grabber.glyph': 'ZiMo',
  'death.grabber.title': "ZiMo's Siphon",
  'death.grabber.reason':
    'ZiMo clutched your heart twice, and the slit-pupil eye in her palm drank your life-fire dry. Lantern light drives her back; darkness hides you.',
  'death.caller.glyph': 'QingLuan',
  'death.caller.title': 'QingLuan Called Your Name',
  'death.caller.reason': 'QingLuan called 「猴哥——」 (“Monkey Bro—”) from behind, and you turned around. While picking, never answer her.',

  'won.glyph': 'HOME',
  'won.title': 'Escaped the Peach Orchard',
  'won.total': 'Haul banked',
  'won.again': 'Raid Again',
  'won.row': '{tier} × {count} = {value}',
  'won.empty': 'Came back empty-handed.',
  'won.newBest': 'New best haul!',
  'won.best': 'Best haul: {n}',

  'touch.light': 'Lantern',
  'touch.sprint': 'Sprint',
  'touch.harvest': 'Pick',
  'touch.pause': 'Pause',

  'hint.harvest.touch': 'Lantern lit · Aim at a glowing peach and hold “Pick” · If someone calls 「猴哥——」 while you pick, do NOT look back.',
  'hint.harvest.mouse': 'Lantern lit · Aim at a glowing peach and hold E / mouse · If someone calls 「猴哥——」 while you pick, do NOT look back.',

  'banner.start.title': 'Peach Heist Eve',
  'banner.start.sub': 'Only a lit cold-blue gate leads home — some lights lie.',
  'banner.caller.title': 'QingLuan Calls Your Name',
  'banner.caller.sub': "Don't look back.",
  'banner.howlerLeave.title': 'JinQue Withdraws',
  'banner.howlerLeave.sub': 'The orchard breathes again — for now.',
  'banner.sanctuary.title': 'Sanctuary Lit',
  'banner.sanctuary.sub': 'Stay inside the light.',
  'banner.bait.title': "JinQue's Trick",
  'banner.bait.sub': 'Not the way home — this light is false.',
  'banner.hunt.title': "JinQue's Siege",
  'banner.hunt.sub': "Run for the real gate — false lights won't shield you.",
  'banner.grab.title': "ZiMo's Siphon",
  'banner.grab.half': 'Half your life-fire torn away.',
  'banner.grab.dead': 'Your life-fire is spent.',
} as const;

export type I18nKey = keyof typeof en;

const zh: Record<I18nKey, string> = {
  'meta.title': '偷桃前夜 · 猴哥 MONKEYBRO',
  'meta.canvas': '夜色蟠桃园第一人称视角',
  'aria.compass': '罗盘',
  'aria.satchel': '桃囊',

  'lang.button': '语言 · 中文',

  'zone.glyph.0': '外园',
  'zone.glyph.1': '雾林',
  'zone.glyph.2': '园心',
  'zone.name.0': '外园 · 月下桃径',
  'zone.name.1': '雾林 · 薄纱迷径',
  'zone.name.2': '园心 · 母树高枝',
  objective: '摘桃 · 寻冷蓝石阙归去',

  'meter.health': '命火',
  'meter.stamina': '脚力',
  'meter.battery': '灯油',
  'meter.healthShort': '命',
  'meter.staminaShort': '力',
  'meter.batteryShort': '灯',
  'light.on': '明',
  'light.off': '熄',

  'tier.short.0': '十年',
  'tier.short.1': '百年',
  'tier.short.2': '千年',
  'tier.short.3': '万年',
  'tier.name.0': '十年桃',
  'tier.name.1': '百年桃',
  'tier.name.2': '千年桃',
  'tier.name.3': '万年蟠桃',
  'satchel.haul': '桃值',

  'prompt.default': '长按摘桃',
  'prompt.hold': '长按摘{tier}',
  'prompt.picking': '正在摘{tier}…',
  'prompt.keyTouch': '按住',
  'hunt.meter': '金阙合围 · 满园追猎',
  'lock.hint': '点击画面以锁定视角',
  'extract.label': '归去中…',
  'compass.n': '北',
  'compass.e': '东',
  'compass.s': '南',
  'compass.w': '西',
  'compass.home': '归',

  'title.h1': '偷桃前夜',
  'title.tagline': 'MONKEYBRO · 蟠桃园夜行',
  'title.rule.peach': '<b>偷蟠桃。</b>桃龄越老光越亮、越值钱——十年、百年、千年、万年。',
  'title.rule.shrine': '<b>寻冷蓝石阙归去。</b>每夜随机亮起两座，逃出去收获才算数。',
  'title.rule.zimo': '<b>紫陌</b>循光循声而来，一握夺你半条命火；灯光能逼退她。',
  'title.rule.qingluan': '<b>青鸾：</b>摘桃时若身后有人唤「猴哥——」，千万别回头。',
  'title.rule.jinque': '<b>金阙：</b>摘下千年、万年桃，她会唤醒满园妖仙合围。',
  'title.start': '入园偷桃',
  'title.controls':
    '<kbd>WASD</kbd> 行走 <kbd>鼠标</kbd> 转身 <kbd>Shift</kbd> 疾奔 <kbd>F</kbd> 灯笼 <kbd>E</kbd>/<kbd>左键</kbd> 长按摘桃 <kbd>Esc</kbd> 暂停',
  'title.best': '最佳收获：{n}',

  'pause.title': '暂歇',
  'pause.flavor': '园子在等。它很有耐心。',
  'pause.resume': '继续',
  'pause.soundOn': '声 · 开',
  'pause.soundOff': '声 · 关',
  'pause.restart': '重来一夜',

  'dead.glyph': '死',
  'dead.title': '你应了那一声',
  'dead.retry': '再入一夜',
  'dead.lost': '散落桃值：{n}',
  'dead.empty': '你两手空空。',
  'death.grabber.glyph': '紫陌',
  'death.grabber.title': '紫陌掠命',
  'death.grabber.reason': '紫陌两度扣住你的心口，掌心竖瞳吸尽了命火。灯光能逼退她，暗处可以藏身。',
  'death.caller.glyph': '青鸾',
  'death.caller.title': '青鸾点名',
  'death.caller.reason': '青鸾在身后唤了一声「猴哥——」，你回了头。摘桃时，切莫应她。',

  'won.glyph': '归',
  'won.title': '逃出蟠桃园',
  'won.total': '入袋桃值',
  'won.again': '再闯一回',
  'won.row': '{tier} × {count} = {value}',
  'won.empty': '空手而归。',
  'won.newBest': '新的最佳收获！',
  'won.best': '最佳收获：{n}',

  'touch.light': '灯笼',
  'touch.sprint': '疾奔',
  'touch.harvest': '摘桃',
  'touch.pause': '暂停',

  'hint.harvest.touch': '灯已点亮 · 对准发光的桃子长按「摘」 · 摘桃时若有人唤「猴哥——」，千万别回头。',
  'hint.harvest.mouse': '灯已点亮 · 对准发光的桃子长按 E / 鼠标 · 摘桃时若有人唤「猴哥——」，千万别回头。',

  'banner.start.title': '偷桃前夜',
  'banner.start.sub': '点亮的冷蓝石阙才是归处；有的灯会骗你。',
  'banner.caller.title': '青鸾点名',
  'banner.caller.sub': '别回头。',
  'banner.howlerLeave.title': '金阙退去',
  'banner.howlerLeave.sub': '园子暂且松了口气。',
  'banner.sanctuary.title': '灯火归位',
  'banner.sanctuary.sub': '守在灯里。',
  'banner.bait.title': '金阙戏弄',
  'banner.bait.sub': '这不是归处——灯是假的。',
  'banner.hunt.title': '金阙合围',
  'banner.hunt.sub': '冲向真归处——假灯没有护体。',
  'banner.grab.title': '紫陌掠命',
  'banner.grab.half': '命火被撕去一半。',
  'banner.grab.dead': '命火已尽。',
};

const TABLES: Record<Lang, Record<I18nKey, string>> = { en, zh };

export type I18nParams = Record<string, string | number>;

function loadLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'en' || v === 'zh') return v;
  } catch {
    /* storage unavailable */
  }
  return 'en';
}

let current: Lang = loadLang();
const listeners = new Set<(lang: Lang) => void>();

export function getLang(): Lang {
  return current;
}

/** Locale for Intl formatting. */
export function locale(): string {
  return current === 'zh' ? 'zh-CN' : 'en-US';
}

/** Number formatted for the active language. */
export function fmt(n: number): string {
  return n.toLocaleString(locale());
}

export function t(key: I18nKey, params?: I18nParams): string {
  let s: string = TABLES[current][key] ?? en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(typeof v === 'number' ? fmt(v) : v);
  }
  return s;
}

export function setLang(lang: Lang): void {
  if (lang !== 'en' && lang !== 'zh') return;
  current = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* storage unavailable */
  }
  applyStaticI18n();
  for (const cb of listeners) cb(lang);
}

export function toggleLang(): Lang {
  setLang(current === 'en' ? 'zh' : 'en');
  return current;
}

/** Subscribe to language changes; returns an unsubscribe function. */
export function onLangChange(cb: (lang: Lang) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Re-apply every `data-i18n*` node plus <html lang> and the document title. */
export function applyStaticI18n(root: ParentNode = document): void {
  document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en';
  document.title = t('meta.title');
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as I18nKey);
  });
  // Only ever fed from the static tables above (never user input), so innerHTML is safe here.
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml as I18nKey);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria as I18nKey));
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle as I18nKey);
  });
}
