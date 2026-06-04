// data.jsx — TrinityOne content (public-domain scripture: KJV + World English Bible)
// Attached to window.TrinityData

const BOOKS = [
  { abbr: 'Gen', name: 'Genesis', ch: 50, group: 'ot' },
  { abbr: 'Exo', name: 'Exodus', ch: 40, group: 'ot' },
  { abbr: 'Psa', name: 'Psalms', ch: 150, group: 'ot' },
  { abbr: 'Pro', name: 'Proverbs', ch: 31, group: 'ot' },
  { abbr: 'Isa', name: 'Isaiah', ch: 66, group: 'ot' },
  { abbr: 'Mat', name: 'Matthew', ch: 28, group: 'nt' },
  { abbr: 'Mar', name: 'Mark', ch: 16, group: 'nt' },
  { abbr: 'Luk', name: 'Luke', ch: 24, group: 'nt' },
  { abbr: 'Joh', name: 'John', ch: 21, group: 'nt' },
  { abbr: 'Act', name: 'Acts', ch: 28, group: 'nt' },
  { abbr: 'Rom', name: 'Romans', ch: 16, group: 'nt' },
  { abbr: 'Phil', name: 'Philippians', ch: 4, group: 'nt' },
  { abbr: 'Rev', name: 'Revelation', ch: 22, group: 'nt' },
];

// Strong's-tagged word → lexeme id, applied per verse
const LEXICON = {
  G3056: { lemma: 'λόγος', translit: 'logos', pos: 'noun, masculine',
    short: 'word; the expression of thought',
    gloss: 'A word, the living spoken expression of an inward thought; reason, the divine utterance by which God reveals himself.',
    occ: 330 },
  G2316: { lemma: 'θεός', translit: 'theos', pos: 'noun, masculine',
    short: 'God; the supreme Divinity',
    gloss: 'God; the one true God, supreme over all creation, the source and ground of all being.',
    occ: 1317 },
  G2222: { lemma: 'ζωή', translit: 'zōē', pos: 'noun, feminine',
    short: 'life; vitality, the breath of being',
    gloss: 'Life — both the physical breath of living and the higher, unending life that belongs to God and is given to those who are his.',
    occ: 135 },
  G5457: { lemma: 'φῶς', translit: 'phōs', pos: 'noun, neuter',
    short: 'light; that which illuminates',
    gloss: 'Light; the source of illumination, used of moral and spiritual radiance that exposes, guides, and gives life.',
    occ: 70 },
  G4561: { lemma: 'σάρξ', translit: 'sarx', pos: 'noun, feminine',
    short: 'flesh; human nature in its frailty',
    gloss: 'Flesh — the soft substance of the body; by extension, human nature in its weakness and mortality.',
    occ: 147 },
  G5485: { lemma: 'χάρις', translit: 'charis', pos: 'noun, feminine',
    short: 'grace; unmerited favour',
    gloss: 'Grace; gracious goodwill and loving-kindness, especially the freely-given, unearned favour of God toward people.',
    occ: 156 },
  G225: { lemma: 'ἀλήθεια', translit: 'alētheia', pos: 'noun, feminine',
    short: 'truth; what is real and reliable',
    gloss: 'Truth; that which is real, faithful, and trustworthy, as opposed to falsehood or mere appearance.',
    occ: 110 },
  G1391: { lemma: 'δόξα', translit: 'doxa', pos: 'noun, feminine',
    short: 'glory; weight, splendour, honour',
    gloss: 'Glory; brightness and splendour, the visible weight of honour, dignity, and majesty.',
    occ: 166 },
};

// Per-verse word tags (case-insensitive match within that verse)
const TAGS = {
  1: { Word: 'G3056', God: 'G2316' },
  3: {},
  4: { life: 'G2222', light: 'G5457' },
  5: { light: 'G5457', darkness: null },
  9: { Light: 'G5457' },
  12: { God: 'G2316' },
  13: { flesh: 'G4561', God: 'G2316' },
  14: { Word: 'G3056', flesh: 'G4561', glory: 'G1391', grace: 'G5485', truth: 'G225' },
};

const JOHN1_KJV = [
  'In the beginning was the Word, and the Word was with God, and the Word was God.',
  'The same was in the beginning with God.',
  'All things were made by him; and without him was not any thing made that was made.',
  'In him was life; and the life was the light of men.',
  'And the light shineth in darkness; and the darkness comprehended it not.',
  'There was a man sent from God, whose name was John.',
  'The same came for a witness, to bear witness of the Light, that all men through him might believe.',
  'He was not that Light, but was sent to bear witness of that Light.',
  'That was the true Light, which lighteth every man that cometh into the world.',
  'He was in the world, and the world was made by him, and the world knew him not.',
  'He came unto his own, and his own received him not.',
  'But as many as received him, to them gave he power to become the sons of God, even to them that believe on his name:',
  'Which were born, not of blood, nor of the will of the flesh, nor of the will of man, but of God.',
  'And the Word was made flesh, and dwelt among us, (and we beheld his glory, the glory as of the only begotten of the Father,) full of grace and truth.',
];

const JOHN1_WEB = [
  'In the beginning was the Word, and the Word was with God, and the Word was God.',
  'The same was in the beginning with God.',
  'All things were made through him. Without him, nothing was made that has been made.',
  'In him was life, and the life was the light of men.',
  "The light shines in the darkness, and the darkness hasn't overcome it.",
  'There came a man sent from God, whose name was John.',
  'The same came as a witness, that he might testify about the light, that all might believe through him.',
  'He was not the light, but was sent that he might testify about the light.',
  'The true light that enlightens everyone was coming into the world.',
  "He was in the world, and the world was made through him, and the world didn't recognize him.",
  "He came to his own, and those who were his own didn't receive him.",
  "But as many as received him, to them he gave the right to become God's children, to those who believe in his name:",
  'who were born not of blood, nor of the will of the flesh, nor of the will of man, but of God.',
  'The Word became flesh and lived among us. We saw his glory, such glory as of the one and only Son of the Father, full of grace and truth.',
];

const CROSSREFS = {
  1: [
    { ref: 'Genesis 1:1', text: 'In the beginning God created the heaven and the earth.' },
    { ref: '1 John 1:1', text: 'That which was from the beginning… concerning the Word of life.' },
    { ref: 'Revelation 19:13', text: 'and his name is called The Word of God.' },
    { ref: 'Colossians 1:17', text: 'And he is before all things, and by him all things consist.' },
  ],
  4: [
    { ref: 'John 8:12', text: 'I am the light of the world: he that followeth me shall not walk in darkness.' },
    { ref: 'John 11:25', text: 'I am the resurrection, and the life.' },
    { ref: '1 John 5:11', text: 'God hath given to us eternal life, and this life is in his Son.' },
  ],
  14: [
    { ref: 'Philippians 2:7', text: 'made himself of no reputation, and took upon him the form of a servant.' },
    { ref: 'Colossians 2:9', text: 'For in him dwelleth all the fulness of the Godhead bodily.' },
  ],
};

const COMMENTARY = {
  source: "TrinityOne Study Notes",
  blocks: [
    { v: '1', title: 'The Word before time',
      text: 'John opens not with a manger but with eternity. Where Genesis says "In the beginning God created," John reaches further back: in the beginning the Word already was. Three short clauses set the whole Gospel in motion — the Word existed, the Word was in relationship ("with God"), and the Word was himself fully God.' },
    { v: '3', title: 'Everything through him',
      text: 'Nothing that exists stands outside his making. The created order is not an accident or a rival power; it is spoken into being through the Word. This frames the rest of the chapter — the one who made the world is the one who steps into it.' },
    { v: '4–5', title: 'Light the darkness cannot hold',
      text: 'Life and light belong together. The image is of a single lamp in a vast dark room: the darkness is real, but it has no power to put the light out. The verb is deliberately ambiguous — the darkness neither understood nor overcame the light.' },
  ],
};

const DEVOTIONAL = {
  series: 'Mornings in John',
  day: 'Day 4',
  title: 'A Light the Dark Can’t Hold',
  ref: 'John 1:5',
  read: '2 min',
  body: [
    'There is a particular kind of darkness that arrives quietly — not dramatic, just heavy. The kind that makes the morning feel like a thing to survive rather than receive.',
    'John does not pretend the darkness isn’t real. He simply insists it isn’t final. “The light shines in the darkness, and the darkness has not overcome it.” Notice the tense: the light *shines*, present and ongoing. It is shining now, in whatever room you are reading this.',
    'You do not have to manufacture the light today. You only have to turn toward it.',
  ],
  prompt: 'Where do you most need light to shine today? Name one place, honestly.',
};

const VOTD = {
  ref: 'John 1:5',
  text: 'The light shines in the darkness, and the darkness has not overcome it.',
  version: 'WEB',
};

const PLANS = [
  { id: 'john21', title: 'The Gospel of John', sub: '21 days', len: 21, done: 4,
    accent: 'var(--clay)', tag: 'Gospels', blurb: 'Walk slowly through John, one passage a morning.' },
  { id: 'psalms', title: 'Psalms of Comfort', sub: '7 days', len: 7, done: 0,
    accent: 'var(--sage)', tag: 'Devotional', blurb: 'A week in the Psalms for anxious seasons.' },
  { id: 'proverbs', title: 'A Proverb a Day', sub: '31 days', len: 31, done: 12,
    accent: 'var(--gold)', tag: 'Wisdom', blurb: 'Daily wisdom, one chapter of Proverbs at a time.' },
  { id: 'nt-year', title: 'New Testament in a Year', sub: '365 days', len: 365, done: 96,
    accent: 'var(--clay)', tag: 'Whole Bible', blurb: 'The steady, achievable path through the NT.' },
];

const PLAN_DETAIL = {
  id: 'john21',
  title: 'The Gospel of John',
  sub: '21 days · one passage each morning',
  done: 4,
  len: 21,
  days: [
    { d: 1, ref: 'John 1:1–18', label: 'The Word', status: 'done' },
    { d: 2, ref: 'John 1:19–34', label: 'A voice in the wilderness', status: 'done' },
    { d: 3, ref: 'John 1:35–51', label: 'Come and see', status: 'done' },
    { d: 4, ref: 'John 2:1–12', label: 'Water into wine', status: 'today' },
    { d: 5, ref: 'John 3:1–21', label: 'Born again', status: 'todo' },
    { d: 6, ref: 'John 4:1–26', label: 'The well', status: 'todo' },
    { d: 7, ref: 'John 5:1–18', label: 'Rise and walk', status: 'todo' },
  ],
};

const MODULES = [
  { id: 'bibles', name: 'Bibles', count: '12 versions', icon: 'book', accent: 'var(--clay)' },
  { id: 'commentaries', name: 'Commentaries', count: '8 sets', icon: 'comment', accent: 'var(--sage)' },
  { id: 'dictionaries', name: 'Dictionaries & Lexicons', count: '6 references', icon: 'lex', accent: 'var(--gold)' },
  { id: 'devotionals', name: 'Devotionals', count: '5 series', icon: 'sun', accent: 'var(--clay)' },
  { id: 'books', name: 'Books', count: '34 titles', icon: 'books', accent: 'var(--sage)' },
  { id: 'journals', name: 'Journals & Notes', count: '23 entries', icon: 'pen', accent: 'var(--gold)' },
];

const COLLECTIONS = [
  { id: 'highlights', name: 'Highlights', count: 41, icon: 'marker' },
  { id: 'bookmarks', name: 'Bookmarks', count: 12, icon: 'bookmark' },
  { id: 'notes', name: 'Notes', count: 23, icon: 'pen' },
  { id: 'crossrefs', name: 'Cross References', count: '—', icon: 'link' },
];

const JOURNAL = [
  { id: 'j1', date: 'Today', ref: 'John 1:4', color: 'var(--hl-yellow)',
    title: 'In him was life',
    body: 'Life and light keep showing up together in John. I want to remember that the life comes first — the light is what the life looks like when it spills out.' },
  { id: 'j2', date: 'Yesterday', ref: 'Psalm 23:4', color: 'var(--hl-blue)',
    title: 'Through the valley',
    body: 'Through, not around. He doesn’t promise no valley. He promises company in it.' },
  { id: 'j3', date: 'May 28', ref: 'Philippians 4:6', color: 'var(--hl-green)',
    title: 'Anxious for nothing',
    body: 'The antidote to anxiety here isn’t certainty — it’s prayer with thanksgiving. Gratitude as a doorway out of worry.' },
];

const SEARCH_SEED = ['light', 'grace', 'shepherd', 'love', 'peace'];
const SEARCH_RESULTS = {
  light: {
    scripture: [
      { ref: 'John 1:5', text: 'The light shines in the darkness, and the darkness has not overcome it.' },
      { ref: 'John 8:12', text: 'I am the light of the world: he that followeth me shall not walk in darkness.' },
      { ref: 'Psalm 119:105', text: 'Thy word is a lamp unto my feet, and a light unto my path.' },
      { ref: 'Matthew 5:14', text: 'Ye are the light of the world. A city that is set on an hill cannot be hid.' },
    ],
    lexicon: ['G5457'],
    count: 274,
  },
};

// ── Watch / video ──
const VIDEO_CATS = ['All', 'Sermons', 'Worship', 'Teaching', 'Kids'];

const CHANNELS = [
  { id: 'grace', name: 'Grace Chapel', handle: '@gracechapel', subs: '48.2K', accent: 'var(--clay)' },
  { id: 'hillside', name: 'Hillside Community', handle: '@hillside', subs: '12.7K', accent: 'var(--sage)' },
  { id: 'wellspring', name: 'Wellspring Worship', handle: '@wellspring', subs: '210K', accent: 'var(--gold)' },
];

// ytId left null = curated placeholder poster (paste a link to play in-app).
const VIDEOS = [
  { id: 'v1', title: 'In the Beginning Was the Word — John 1', channel: 'Grace Chapel', cat: 'Sermons',
    dur: '42:18', when: '2 days ago', views: '8.1K', accent: 'var(--clay)', icon: 'read', live: true, ytId: null,
    desc: 'Pastor opens the Gospel of John, walking through the prologue and what it means that the Word became flesh and dwelt among us.' },
  { id: 'v2', title: 'Oceans (Sunday Worship Set)', channel: 'Wellspring Worship', cat: 'Worship',
    dur: '11:54', when: '5 days ago', views: '63K', accent: 'var(--gold)', icon: 'headphones', ytId: null,
    desc: 'Full worship set from Sunday morning — gather, breathe, and sing along.' },
  { id: 'v3', title: 'How to Study a Whole Book of the Bible', channel: 'Hillside Community', cat: 'Teaching',
    dur: '23:07', when: '1 week ago', views: '3.4K', accent: 'var(--sage)', icon: 'lex', ytId: null,
    desc: 'A practical walkthrough of reading Scripture in context — themes, structure, and study tools.' },
  { id: 'v4', title: 'The Parable of the Lost Sheep (for Kids)', channel: 'Grace Chapel', cat: 'Kids',
    dur: '6:42', when: '2 weeks ago', views: '15K', accent: 'var(--clay)', icon: 'sun', ytId: null,
    desc: 'A short, gentle retelling of the lost sheep for little ones and family devotions.' },
  { id: 'v5', title: 'Abide — Evening Prayer & Reflection', channel: 'Hillside Community', cat: 'Worship',
    dur: '18:30', when: '3 weeks ago', views: '9.2K', accent: 'var(--sage)', icon: 'moon', ytId: null,
    desc: 'A quiet, candle-lit evening liturgy to close the day in peace.' },
];

// ── Fellowship: anonymous chat (Nostr) ──
// HANDLE_POOL + CHAT_IDENTITY are the mock fallback; once the real identity layer
// (lib/identity.js) derives a key, it overrides window.TrinityData.CHAT_IDENTITY.
const HANDLE_POOL = ['Cedar', 'River', 'Sparrow', 'Olive', 'Wren', 'Maple', 'Reed', 'Dove', 'Ash', 'Linden', 'Heron', 'Bramble'];

const CHAT_IDENTITY = {
  handle: 'Anonymous Cedar',
  npub: 'npub1q8s7v3x2k9m4f7p0r6t1y5w8n2c4j6h3l9d0a',
  color: '#5E8C6A',
};

const RELAYS = [
  { url: 'relay.damus.io', status: 'on' },
  { url: 'nos.lol', status: 'on' },
  { url: 'relay.trinityone.faith', status: 'on' },
  { url: 'relay.snort.social', status: 'off' },
];

const GROUPS = [
  { id: 'sunday', name: 'Sunday Life Group', kind: 'Life Group', members: 14, accent: 'var(--clay)',
    unread: 3, last: 'Anonymous River: see you all at 6 — bringing the chili 🌶 minus the emoji', when: '2m' },
  { id: 'mens', name: "Men's Bible Study", kind: 'Ministry', members: 9, accent: 'var(--sage)',
    unread: 0, last: 'You: Reading John 1 again this week', when: '1h' },
  { id: 'prayer', name: 'Prayer Requests', kind: 'Whole Church', members: 132, accent: 'var(--gold)',
    unread: 7, last: 'Anonymous Wren: please pray for my mom’s surgery tomorrow', when: '12m', prayer: true },
  { id: 'youth', name: 'Youth Group', kind: 'Ministry', members: 28, accent: 'var(--clay)',
    unread: 0, last: 'Anonymous Sparrow: who’s in for the lock-in?', when: '3h' },
  { id: 'church', name: 'Trinity — All', kind: 'Whole Church', members: 312, accent: 'var(--sage)',
    unread: 0, last: 'Anonymous Maple: thank you for a beautiful service', when: 'Yesterday' },
];

const GROUP_MESSAGES = {
  sunday: [
    { id: 'm1', handle: 'Anonymous Olive', color: '#C2913A', text: 'Morning everyone! Did the reading hit anyone else hard this week?', when: '8:02' },
    { id: 'm2', handle: 'Anonymous River', color: '#5E8C6A', text: 'Yeah. The “light shines in the darkness” line has been with me all week.', when: '8:05' },
    { id: 'm3', me: true, handle: 'Anonymous Cedar', color: '#5E8C6A', text: 'Same. I keep coming back to how the darkness can’t overcome it — present tense.', when: '8:07' },
    { id: 'm4', handle: 'Anonymous River', color: '#5E8C6A', kind: 'verse',
      verse: { ref: 'John 1:5', text: 'The light shines in the darkness, and the darkness has not overcome it.', version: 'WEB' }, when: '8:08' },
    { id: 'm5', handle: 'Anonymous Wren', color: '#C25A38', text: 'Sharing this on my lock screen today. Thank you 🙏', when: '8:11' },
    { id: 'm6', handle: 'Anonymous Olive', color: '#C2913A', kind: 'prayer', amens: 4,
      text: 'Quick prayer request — job interview at 2pm today. Nervous but trusting.', when: '8:14' },
    { id: 'm7', me: true, handle: 'Anonymous Cedar', color: '#5E8C6A', text: 'Praying right now. You’ve got this.', when: '8:15' },
  ],
  prayer: [
    { id: 'p1', handle: 'Anonymous Wren', color: '#C25A38', kind: 'prayer', amens: 23,
      text: 'Please pray for my mom’s surgery tomorrow morning. Anxious but hopeful.', when: '12m' },
    { id: 'p2', handle: 'Anonymous Heron', color: '#5E8C6A', kind: 'prayer', amens: 11,
      text: 'Grieving a friend this week. Just need to feel held.', when: '40m' },
    { id: 'p3', handle: 'Anonymous Reed', color: '#C2913A', kind: 'prayer', amens: 8,
      text: 'Praising — six months sober today. Thank you for carrying me here.', when: '1h' },
  ],
  mens: [
    { id: 'x1', handle: 'Anonymous Ash', color: '#C2913A', text: 'Reading John 1 again this week — who’s leading?', when: 'Mon' },
    { id: 'x2', me: true, handle: 'Anonymous Cedar', color: '#5E8C6A', text: 'I can take it. Let’s meet at the usual spot.', when: 'Mon' },
  ],
  youth: [
    { id: 'y1', handle: 'Anonymous Sparrow', color: '#C25A38', text: 'who’s in for the lock-in?? 🙌', when: '3h' },
    { id: 'y2', handle: 'Anonymous Linden', color: '#5E8C6A', text: 'meee bringing snacks', when: '3h' },
  ],
  church: [
    { id: 'c1', handle: 'Anonymous Maple', color: '#5E8C6A', text: 'Thank you for a beautiful service today. Felt like home.', when: 'Yesterday' },
  ],
};

// ── Fellowship: Lightning giving (mock — no real funds move yet) ──
const SATS_PER_USD = 1075; // mock spot rate (~$93k/BTC)
const WALLET = { sats: 48250, address: 'cedar@trinity.faith', node: 'Strike' };
const FUNDS = [
  { id: 'tithe', name: 'Tithe & Offering', desc: 'General fund — wherever needed most', icon: 'heart', accent: 'var(--clay)' },
  { id: 'missions', name: 'Missions', desc: 'Supporting partners around the world', icon: 'globe', accent: 'var(--sage)' },
  { id: 'building', name: 'Building Fund', desc: 'The new youth & community space', icon: 'library', accent: 'var(--gold)' },
  { id: 'benevolence', name: 'Benevolence', desc: 'Helping families in hard seasons', icon: 'pray', accent: 'var(--clay)' },
];
const STRIKE_PRESETS = [10, 25, 50, 100];
const GIVING_HISTORY = [
  { id: 'g1', fund: 'Tithe & Offering', sats: 10750, usd: 10, when: 'Today · 8:14', anon: true, status: 'settled' },
  { id: 'g2', fund: 'Missions', sats: 26875, usd: 25, when: 'May 28', anon: true, status: 'settled' },
  { id: 'g3', fund: 'Benevolence', sats: 5375, usd: 5, when: 'May 21', anon: false, status: 'settled', zap: true, to: 'Anonymous Wren’s prayer' },
  { id: 'g4', fund: 'Building Fund', sats: 53750, usd: 50, when: 'May 4', anon: true, status: 'settled' },
];

window.TrinityData = {
  BOOKS, LEXICON, TAGS, CROSSREFS, COMMENTARY, DEVOTIONAL, VOTD,
  PLANS, PLAN_DETAIL, MODULES, COLLECTIONS, JOURNAL, SEARCH_SEED, SEARCH_RESULTS,
  VIDEO_CATS, CHANNELS, VIDEOS,
  HANDLE_POOL, CHAT_IDENTITY, RELAYS, GROUPS, GROUP_MESSAGES,
  SATS_PER_USD, WALLET, FUNDS, STRIKE_PRESETS, GIVING_HISTORY,
  CHAPTER: {
    book: 'John', bookAbbr: 'Joh', ch: 1,
    heading: 'The Word Became Flesh',
    versions: {
      KJV: { name: 'King James Version', verses: JOHN1_KJV },
      WEB: { name: 'World English Bible', verses: JOHN1_WEB },
      ASV: { name: 'American Standard Version', verses: JOHN1_KJV },
    },
  },
};
