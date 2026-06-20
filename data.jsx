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

// Concordance: every use of a lemma (keyed by the same Strong's ids as LEXICON).
// `en` = the English term(s) to highlight in each citation.
const CONCORDANCE = {
  G3056: { en: ['word'], uses: [
    { ref: 'John 1:1', text: 'In the beginning was the Word, and the Word was with God, and the Word was God.' },
    { ref: 'John 1:14', text: 'The Word became flesh and lived among us.' },
    { ref: 'Hebrews 4:12', text: 'For the word of God is living and active, sharper than any two-edged sword.' },
    { ref: 'Luke 8:11', text: 'Now the parable is this: The seed is the word of God.' },
    { ref: 'Colossians 3:16', text: 'Let the word of Christ dwell in you richly.' },
    { ref: 'James 1:22', text: 'But be doers of the word, and not only hearers.' },
    { ref: '1 John 1:1', text: 'That which we have heard… concerning the Word of life.' },
    { ref: 'Revelation 19:13', text: 'He is clothed in a garment sprinkled with blood. His name is called "The Word of God."' },
  ] },
  G2316: { en: ['God', "God's"], uses: [
    { ref: 'John 1:1', text: 'In the beginning was the Word… and the Word was God.' },
    { ref: 'John 3:16', text: 'For God so loved the world, that he gave his one and only Son.' },
    { ref: 'Romans 8:28', text: 'We know that all things work together for good to those who love God.' },
    { ref: '1 John 4:8', text: 'The one who doesn’t love doesn’t know God, for God is love.' },
    { ref: 'Mark 12:30', text: 'You shall love the Lord your God with all your heart.' },
    { ref: 'Ephesians 2:8', text: 'For by grace you have been saved through faith… it is the gift of God.' },
    { ref: 'Philippians 4:6', text: 'Let your requests be made known to God.' },
  ] },
  G2222: { en: ['life'], uses: [
    { ref: 'John 1:4', text: 'In him was life, and the life was the light of men.' },
    { ref: 'John 3:16', text: 'Whoever believes in him should not perish, but have eternal life.' },
    { ref: 'John 10:10', text: 'I came that they may have life, and may have it abundantly.' },
    { ref: 'John 11:25', text: 'I am the resurrection and the life.' },
    { ref: 'John 14:6', text: 'I am the way, the truth, and the life.' },
    { ref: 'John 6:35', text: 'I am the bread of life.' },
    { ref: 'Romans 6:23', text: 'But the free gift of God is eternal life in Christ Jesus our Lord.' },
    { ref: '1 John 5:12', text: 'He who has the Son has the life.' },
  ] },
  G5457: { en: ['light'], uses: [
    { ref: 'John 1:5', text: 'The light shines in the darkness, and the darkness hasn’t overcome it.' },
    { ref: 'John 1:9', text: 'The true light that enlightens everyone was coming into the world.' },
    { ref: 'John 8:12', text: 'I am the light of the world. He who follows me will have the light of life.' },
    { ref: 'John 12:46', text: 'I have come as a light into the world.' },
    { ref: 'Matthew 5:14', text: 'You are the light of the world. A city set on a hill can’t be hidden.' },
    { ref: 'Matthew 5:16', text: 'Let your light shine before men, that they may see your good works.' },
    { ref: '2 Corinthians 4:6', text: 'It is God who said, "Light will shine out of darkness," who has shone in our hearts.' },
    { ref: '1 John 1:5', text: 'God is light, and in him is no darkness at all.' },
    { ref: 'Ephesians 5:8', text: 'For you were once darkness, but are now light in the Lord.' },
  ] },
  G4561: { en: ['flesh'], uses: [
    { ref: 'John 1:14', text: 'The Word became flesh and lived among us.' },
    { ref: 'John 6:51', text: 'The bread which I will give for the life of the world is my flesh.' },
    { ref: 'Romans 8:3', text: 'God, sending his own Son in the likeness of sinful flesh.' },
    { ref: 'Galatians 5:16', text: 'Walk by the Spirit, and you won’t fulfill the lust of the flesh.' },
    { ref: 'Matthew 26:41', text: 'The spirit indeed is willing, but the flesh is weak.' },
    { ref: '1 Peter 1:24', text: 'All flesh is like grass, and all its glory like the flower in the grass.' },
  ] },
  G5485: { en: ['grace'], uses: [
    { ref: 'John 1:14', text: 'We saw his glory… full of grace and truth.' },
    { ref: 'John 1:16', text: 'Of his fullness we all received grace upon grace.' },
    { ref: 'Ephesians 2:8', text: 'For by grace you have been saved through faith.' },
    { ref: '2 Corinthians 12:9', text: 'He has said to me, "My grace is sufficient for you."' },
    { ref: 'Romans 6:14', text: 'You are not under law, but under grace.' },
    { ref: 'Titus 2:11', text: 'For the grace of God has appeared, bringing salvation to all people.' },
  ] },
  G225: { en: ['truth'], uses: [
    { ref: 'John 1:14', text: 'We saw his glory… full of grace and truth.' },
    { ref: 'John 8:32', text: 'You will know the truth, and the truth will make you free.' },
    { ref: 'John 14:6', text: 'I am the way, the truth, and the life.' },
    { ref: 'John 17:17', text: 'Sanctify them in your truth. Your word is truth.' },
    { ref: 'John 4:24', text: 'Those who worship him must worship in spirit and truth.' },
    { ref: '3 John 1:4', text: 'I have no greater joy than this, to hear about my children walking in truth.' },
  ] },
  G1391: { en: ['glory'], uses: [
    { ref: 'John 1:14', text: 'We saw his glory, such glory as of the one and only Son of the Father.' },
    { ref: 'John 17:5', text: 'Glorify me… with the glory which I had with you before the world existed.' },
    { ref: 'Romans 3:23', text: 'For all have sinned, and fall short of the glory of God.' },
    { ref: 'Romans 8:18', text: 'The sufferings… aren’t worthy to be compared with the glory which will be revealed.' },
    { ref: '2 Corinthians 3:18', text: 'We are transformed into the same image from glory to glory.' },
    { ref: '1 Corinthians 10:31', text: 'Whatever you do, do all to the glory of God.' },
  ] },
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

const COMMENTARY = { source: '', blocks: [] };   // no seeded commentary — a real .cmt.mybible module would populate it
const DEVOTIONAL = { series: '', day: '', title: '', ref: '', read: '', body: [], prompt: '' };   // no built-in sample devotional (church devotionals come from the steward)

const VOTD = {
  ref: 'John 1:5',
  text: 'The light shines in the darkness, and the darkness has not overcome it.',
  version: 'WEB',
};

// rotated daily by day-of-year; text below is a fallback when the active
// translation lacks the verse (otherwise the live module text is used).
const VOTD_POOL = [
  { ref: 'John 1:5', text: 'The light shines in the darkness, and the darkness has not overcome it.' },
  { ref: 'Psalms 23:1', text: 'The LORD is my shepherd; I shall not want.' },
  { ref: 'Proverbs 3:5', text: 'Trust in the LORD with all thine heart; and lean not unto thine own understanding.' },
  { ref: 'Isaiah 41:10', text: 'Fear thou not; for I am with thee: be not dismayed; for I am thy God.' },
  { ref: 'Philippians 4:6', text: 'Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God.' },
  { ref: 'Romans 8:28', text: 'And we know that all things work together for good to them that love God.' },
  { ref: 'Matthew 11:28', text: 'Come unto me, all ye that labour and are heavy laden, and I will give you rest.' },
  { ref: 'Psalms 46:1', text: 'God is our refuge and strength, a very present help in trouble.' },
  { ref: 'Joshua 1:9', text: 'Be strong and of a good courage; be not afraid, neither be thou dismayed: for the LORD thy God is with thee.' },
  { ref: 'Lamentations 3:22', text: 'It is of the LORD’s mercies that we are not consumed, because his compassions fail not.' },
  { ref: 'John 14:27', text: 'Peace I leave with you, my peace I give unto you.' },
  { ref: '2 Corinthians 5:17', text: 'Therefore if any man be in Christ, he is a new creature.' },
  { ref: 'Psalms 119:105', text: 'Thy word is a lamp unto my feet, and a light unto my path.' },
  { ref: 'Hebrews 13:8', text: 'Jesus Christ the same yesterday, and to day, and for ever.' },
];

// ── reading plans (real day-by-day passages, parsed + opened in the reader) ──
const _johnLabels = ['The Word made flesh', 'Water into wine', 'Born again', 'The woman at the well', 'The healing pool',
  'Bread of life', 'Rivers of living water', 'The light of the world', 'The man born blind', 'The good shepherd',
  'The raising of Lazarus', 'The hour has come', 'The foot-washing', 'The way, the truth, the life', 'The true vine',
  'The Counselor promised', 'The high-priestly prayer', 'Betrayal and arrest', 'The crucifixion', 'The empty tomb', 'Breakfast by the sea'];
const _psalms = [[23, 'The LORD my shepherd'], [27, 'The LORD my light'], [34, 'Taste and see'], [42, 'As the deer'],
  [46, 'A very present help'], [91, 'Under his wings'], [121, 'My help comes from the LORD']];
const _ntChapters = [['Matthew', 28], ['Mark', 16], ['Luke', 24], ['John', 21], ['Acts', 28], ['Romans', 16],
  ['1 Corinthians', 16], ['2 Corinthians', 13], ['Galatians', 6], ['Ephesians', 6], ['Philippians', 4], ['Colossians', 4],
  ['1 Thessalonians', 5], ['2 Thessalonians', 3], ['1 Timothy', 6], ['2 Timothy', 4], ['Titus', 3], ['Philemon', 1],
  ['Hebrews', 13], ['James', 5], ['1 Peter', 5], ['2 Peter', 3], ['1 John', 5], ['2 John', 1], ['3 John', 1], ['Jude', 1], ['Revelation', 22]];
function _ntDays() { const out = []; let d = 0; for (const [bk, n] of _ntChapters) for (let c = 1; c <= n; c++) out.push({ d: ++d, ref: `${bk} ${c}`, label: `${bk} ${c}` }); return out; }

const PLANS = [
  { id: 'john21', title: 'The Gospel of John', sub: '21 days · a chapter a morning', tag: 'Gospels', accent: 'var(--clay)',
    blurb: 'Walk slowly through John, one chapter a day.',
    days: _johnLabels.map((label, i) => ({ d: i + 1, ref: `John ${i + 1}`, label })) },
  { id: 'psalms', title: 'Psalms of Comfort', sub: '7 days', tag: 'Devotional', accent: 'var(--sage)',
    blurb: 'A week in the Psalms for anxious seasons.',
    days: _psalms.map(([n, label], i) => ({ d: i + 1, ref: `Psalms ${n}`, label })) },
  { id: 'proverbs', title: 'A Proverb a Day', sub: '31 days', tag: 'Wisdom', accent: 'var(--gold)',
    blurb: 'Daily wisdom, one chapter of Proverbs at a time.',
    days: Array.from({ length: 31 }, (_, i) => ({ d: i + 1, ref: `Proverbs ${i + 1}`, label: `Chapter ${i + 1}` })) },
  { id: 'nt-year', title: 'The New Testament', sub: '260 days · a chapter a day', tag: 'Whole NT', accent: 'var(--clay)',
    blurb: 'The steady, achievable path through the New Testament.',
    days: _ntDays() },
  { id: 'mark', title: 'The Gospel of Mark', sub: '16 days · a chapter a day', tag: 'Gospels', accent: 'var(--clay)',
    blurb: 'The fast-moving, action-packed account of Jesus’ life.',
    days: Array.from({ length: 16 }, (_, i) => ({ d: i + 1, ref: `Mark ${i + 1}`, label: `Chapter ${i + 1}` })) },
  { id: 'romans', title: 'Romans', sub: '16 days', tag: 'Epistles', accent: 'var(--sage)',
    blurb: 'Paul’s great letter on grace, faith and the gospel.',
    days: Array.from({ length: 16 }, (_, i) => ({ d: i + 1, ref: `Romans ${i + 1}`, label: `Chapter ${i + 1}` })) },
  { id: 'sermon-mount', title: 'The Sermon on the Mount', sub: '3 days', tag: 'Teaching', accent: 'var(--gold)',
    blurb: 'Jesus’ most famous teaching, in three sittings.',
    days: [{ d: 1, ref: 'Matthew 5', label: 'The Beatitudes' }, { d: 2, ref: 'Matthew 6', label: 'Prayer & treasure' }, { d: 3, ref: 'Matthew 7', label: 'The narrow way' }] },
  { id: 'philippians', title: 'Philippians', sub: '4 days · joy', tag: 'Epistles', accent: 'var(--clay)',
    blurb: 'Paul’s letter of joy, written from prison.',
    days: Array.from({ length: 4 }, (_, i) => ({ d: i + 1, ref: `Philippians ${i + 1}`, label: `Chapter ${i + 1}` })) },
  { id: 'james', title: 'James', sub: '5 days · faith that works', tag: 'Wisdom', accent: 'var(--sage)',
    blurb: 'Practical wisdom for everyday faith.',
    days: Array.from({ length: 5 }, (_, i) => ({ d: i + 1, ref: `James ${i + 1}`, label: `Chapter ${i + 1}` })) },
  { id: 'christmas', title: 'The Christmas Story', sub: '4 days · Advent', tag: 'Advent', accent: 'var(--gold)',
    blurb: 'The birth of Jesus across Luke and Matthew.',
    days: [{ d: 1, ref: 'Luke 1', label: 'The announcement' }, { d: 2, ref: 'Luke 2', label: 'The birth' }, { d: 3, ref: 'Matthew 1', label: 'Joseph’s dream' }, { d: 4, ref: 'Matthew 2', label: 'The wise men' }] },
  { id: 'easter', title: 'The Story of Easter', sub: '5 days · Holy Week', tag: 'Easter', accent: 'var(--clay)',
    blurb: 'Walk through the cross and resurrection in John.',
    days: [{ d: 1, ref: 'John 18', label: 'Betrayed & arrested' }, { d: 2, ref: 'John 19', label: 'The crucifixion' }, { d: 3, ref: 'John 20', label: 'The empty tomb' }, { d: 4, ref: 'John 21', label: 'Restored' }, { d: 5, ref: '1 Corinthians 15', label: 'Why it matters' }] },
];
PLANS.forEach(p => { p.len = p.days.length; });

const MODULES = [
  { id: 'bibles', name: 'Bibles', count: '12 versions', icon: 'book', accent: 'var(--clay)' },
  { id: 'commentaries', name: 'Commentaries', count: '8 sets', icon: 'comment', accent: 'var(--sage)' },
  { id: 'dictionaries', name: 'Dictionaries & Lexicons', count: '6 references', icon: 'lex', accent: 'var(--gold)' },
  { id: 'devotionals', name: 'Devotionals', count: '5 series', icon: 'sun', accent: 'var(--clay)' },
  { id: 'books', name: 'Books', count: '25 free titles', icon: 'books', accent: 'var(--sage)' },
  { id: 'journals', name: 'Journals & Notes', count: '3 entries', icon: 'pen', accent: 'var(--gold)' },
];

const COLLECTIONS = [
  { id: 'highlights', name: 'Highlights', count: 9, icon: 'marker' },
  { id: 'bookmarks', name: 'Bookmarks', count: 7, icon: 'bookmark' },
  { id: 'notes', name: 'Notes', count: 6, icon: 'pen' },
  { id: 'crossrefs', name: 'Cross References', count: 5, icon: 'link' },
];
// Prayer list intentionally NOT a Library collection -- it's community-shaped; the MyData
// 'prayer' type + CollectionView handling stay in place for a future Community-page home.

// sample personal prayer list (seeds MyData on first run; then user-owned + private)
const PRAYER_SEED = [];   // no seeded prayers — the member's own come from MyData

const JOURNAL = [];   // no seed data — the member's own journal entries come from MyData

const SEARCH_SEED = [];   // no seeded recent searches
const SEARCH_RESULTS = {};   // search uses the live engine; no seeded results

// ── Watch / video ──
const VIDEO_CATS = ['All'];   // no seeded video content

const CHANNELS = [];   // no seeded channels

// ytId left null = curated placeholder poster (paste a link to play in-app).
const VIDEOS = [];   // no seeded videos

// ── Fellowship: anonymous chat (Nostr) ──
// HANDLE_POOL + CHAT_IDENTITY are the mock fallback; once the real identity layer
// (lib/identity.js) derives a key, it overrides window.TrinityData.CHAT_IDENTITY.
const HANDLE_POOL = ['Cedar', 'River', 'Sparrow', 'Olive', 'Wren', 'Maple', 'Reed', 'Dove', 'Ash', 'Linden', 'Heron', 'Bramble'];

// avatar picker: Halo-styled symbols + a brand color palette (+ an optional photo when the church allows it and the member isn't a minor)
const AVATAR_COLORS = ['#C25A38', '#5E8C6A', '#C8962E', '#5360D6', '#C24B7A', '#2A8C82', '#9C5BB8', '#46708C'];
const AVATAR_SYMBOLS = ['halo', 'dove', 'fish', 'flame', 'vine', 'wheat', 'anchor', 'crook', 'chalice', 'olive', 'mountain', 'well', 'star'];

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

// Churches the member follows; groups + giving funds are scoped to the active one.
const CHURCHES = [];   // no sample churches — the member follows their real church by npub (scan/paste)

const GROUPS = [];   // no sample groups — real groups come from the church over the relay

const GROUP_MESSAGES = {};   // no seeded chat — real messages arrive over the relay (Fellowship)

// ── Fellowship: Lightning giving (mock — no real funds move yet) ──
const SATS_PER_USD = 1075; // mock spot rate (~$93k/BTC)
// currencies the member can display giving amounts in. `usd` = how many USD one unit is worth
// (mock rates until a live price feed is wired); sats-per-unit = SATS_PER_USD * usd.
const CURRENCIES = [
  { code: 'USD', symbol: '$',  label: 'US dollar',        usd: 1 },
  { code: 'GBP', symbol: '£',  label: 'British pound',    usd: 1.27 },
  { code: 'EUR', symbol: '€',  label: 'Euro',             usd: 1.08 },
  { code: 'CAD', symbol: 'C$', label: 'Canadian dollar',  usd: 0.73 },
  { code: 'AUD', symbol: 'A$', label: 'Australian dollar', usd: 0.66 },
  { code: 'NGN', symbol: '₦',  label: 'Nigerian naira',   usd: 0.00065 },
  { code: 'ZAR', symbol: 'R',  label: 'South African rand', usd: 0.055 },
  { code: 'INR', symbol: '₹',  label: 'Indian rupee',     usd: 0.012 },
];
const WALLET = { sats: 0, address: '', node: '' };   // giving parked — no mock balance
const FUNDS = [];   // giving parked for the pilot — no sample funds
const STRIKE_PRESETS = [10, 25, 50, 100];
const GIVING_HISTORY = [];   // no sample giving history

// ── Library: items inside each module + collection, and book full-text ──
// resources inside each module — the bookshelf you drill into
const MODULE_ITEMS = {
  bibles: [
    { id: 'web', name: 'World English Bible', sub: 'WEB · public domain', abbr: 'WEB', current: true, downloaded: true },
    { id: 'esv', name: 'English Standard Version', sub: 'ESV · Crossway', abbr: 'ESV', downloaded: true },
    { id: 'kjv', name: 'King James Version', sub: 'KJV · 1611', abbr: 'KJV', downloaded: true },
    { id: 'niv', name: 'New International Version', sub: 'NIV · Biblica', abbr: 'NIV' },
    { id: 'nasb', name: 'New American Standard', sub: 'NASB · Lockman', abbr: 'NASB' },
    { id: 'nlt', name: 'New Living Translation', sub: 'NLT · Tyndale House', abbr: 'NLT' },
    { id: 'csb', name: 'Christian Standard Bible', sub: 'CSB · Holman', abbr: 'CSB' },
    { id: 'nkjv', name: 'New King James Version', sub: 'NKJV · Thomas Nelson', abbr: 'NKJV' },
    { id: 'rsv', name: 'Revised Standard Version', sub: 'RSV · NCC', abbr: 'RSV' },
    { id: 'sblgnt', name: 'Greek New Testament', sub: 'SBLGNT · original language', abbr: 'GRK', original: true, downloaded: true },
    { id: 'wlc', name: 'Hebrew Bible', sub: 'Westminster Leningrad · original', abbr: 'HEB', original: true },
    { id: 'lxx', name: 'Septuagint', sub: 'LXX · Greek Old Testament', abbr: 'LXX', original: true },
  ],
  commentaries: [
    { id: 'mhenry', name: "Matthew Henry's Commentary", sub: 'Whole Bible · Matthew Henry', downloaded: true },
    { id: 'ivpbg', name: 'IVP Bible Background Commentary', sub: 'Keener & Walton' },
    { id: 'calvin', name: "Calvin's Commentaries", sub: 'John Calvin', downloaded: true },
    { id: 'tyndale', name: 'Tyndale NT Commentaries', sub: '20-volume series' },
    { id: 'bkc', name: 'Bible Knowledge Commentary', sub: 'Walvoord & Zuck' },
    { id: 'barnes', name: "Barnes' Notes", sub: 'Albert Barnes', downloaded: true },
    { id: 'ebc', name: "Expositor's Bible Commentary", sub: 'Frank Gaebelein, ed.' },
    { id: 'nicnt', name: 'NICNT / NICOT', sub: 'Bruce, Fee & others' },
  ],
  dictionaries: [
    { id: 'strongs', name: "Strong's Exhaustive Concordance", sub: 'with numbering system', downloaded: true },
    { id: 'thayer', name: "Thayer's Greek Lexicon", sub: 'Greek–English', downloaded: true },
    { id: 'bdb', name: 'Brown–Driver–Briggs', sub: 'Hebrew & English Lexicon' },
    { id: 'vines', name: "Vine's Expository Dictionary", sub: 'W.E. Vine' },
    { id: 'easton', name: "Easton's Bible Dictionary", sub: 'M.G. Easton', downloaded: true },
    { id: 'isbe', name: 'Standard Bible Encyclopedia', sub: 'ISBE · revised' },
  ],
  devotionals: [
    { id: 'utmost', name: 'My Utmost for His Highest', sub: 'Oswald Chambers', downloaded: true },
    { id: 'morneve', name: 'Morning & Evening', sub: 'Charles Spurgeon', downloaded: true },
    { id: 'nmm', name: 'New Morning Mercies', sub: 'Paul David Tripp' },
    { id: 'streams', name: 'Streams in the Desert', sub: 'L.B. Cowman' },
    { id: 'dailylight', name: 'Daily Light on the Daily Path', sub: 'Samuel Bagster' },
  ],
  // Curated Christian classics from the Christian Classics Ethereal Library (ccel.org) — built into
  // vendor/library/ (window.TrinityLibrary.available) and downloaded on demand by the BookReader.
  // Keep this list in step with scripts/build-library-ccel.py; the UI shows the real per-device
  // download state (not a hard-coded flag).
  books: [
    { id: 'pilgrim', name: "The Pilgrim's Progress", sub: 'John Bunyan', cat: 'Allegory' },
    { id: 'holywar', name: 'The Holy War', sub: 'John Bunyan', cat: 'Allegory' },
    { id: 'confessions', name: 'The Confessions', sub: 'Augustine of Hippo', cat: 'Biography' },
    { id: 'grace', name: 'Grace Abounding to the Chief of Sinners', sub: 'John Bunyan', cat: 'Biography' },
    { id: 'imitation', name: 'The Imitation of Christ', sub: 'Thomas à Kempis', cat: 'Devotional' },
    { id: 'presence', name: 'The Practice of the Presence of God', sub: 'Brother Lawrence', cat: 'Devotional' },
    { id: 'interior', name: 'The Interior Castle', sub: 'Teresa of Ávila', cat: 'Devotional' },
    { id: 'seriouscall', name: 'A Serious Call to a Devout and Holy Life', sub: 'William Law', cat: 'Devotional' },
    { id: 'schoolprayer', name: 'With Christ in the School of Prayer', sub: 'Andrew Murray', cat: 'Devotional' },
    { id: 'powerprayer', name: 'Power Through Prayer', sub: 'E.M. Bounds', cat: 'Devotional' },
    { id: 'saintsrest', name: "The Saints' Everlasting Rest", sub: 'Richard Baxter', cat: 'Devotional' },
    { id: 'riseprogress', name: 'The Rise and Progress of Religion in the Soul', sub: 'Philip Doddridge', cat: 'Devotional' },
    { id: 'crook', name: 'The Crook in the Lot', sub: 'Thomas Boston', cat: 'Devotional' },
    { id: 'institutes', name: 'Institutes of the Christian Religion', sub: 'John Calvin', cat: 'Theology' },
    { id: 'doctrine', name: 'On Christian Doctrine', sub: 'Augustine of Hippo', cat: 'Theology' },
    { id: 'affections', name: 'A Treatise Concerning Religious Affections', sub: 'Jonathan Edwards', cat: 'Theology' },
    { id: 'wesley', name: 'Sermons on Several Occasions', sub: 'John Wesley', cat: 'Theology' },
    { id: 'orthodoxy', name: 'Orthodoxy', sub: 'G.K. Chesterton', cat: 'Apologetics' },
    { id: 'pensees', name: 'Pensées', sub: 'Blaise Pascal', cat: 'Apologetics' },
    { id: 'fathers', name: 'Early Christian Fathers', sub: 'Clement, Ignatius, Polycarp & others', cat: 'Church Fathers' },
    { id: 'apostolic', name: 'Apostolic Fathers, Justin Martyr & Irenaeus', sub: 'Ante-Nicene Fathers', cat: 'Church Fathers' },
    { id: 'incarnation', name: 'On the Incarnation of the Word', sub: 'Athanasius of Alexandria', cat: 'Church Fathers' },
    { id: 'enchiridion', name: 'Handbook on Faith, Hope & Love', sub: 'Augustine of Hippo', cat: 'Church Fathers' },
    { id: 'chrysostom', name: 'On the Priesthood', sub: 'John Chrysostom', cat: 'Church Fathers' },
    { id: 'eusebius', name: 'The Church History', sub: 'Eusebius of Caesarea', cat: 'Church Fathers' },
  ],
};

// saved items behind each collection card
const COLLECTION_ITEMS = {
  highlights: [
    { ref: 'John 1:4', text: 'In him was life, and the life was the light of men.', color: 'var(--hl-yellow)' },
    { ref: 'Psalm 23:4', text: 'Even though I walk through the valley of the shadow of death, I will fear no evil, for you are with me.', color: 'var(--hl-blue)' },
    { ref: 'Romans 8:28', text: 'We know that all things work together for good to those who love God.', color: 'var(--hl-green)' },
    { ref: 'Isaiah 41:10', text: 'Don’t be afraid, for I am with you. Don’t be dismayed, for I am your God.', color: 'var(--hl-yellow)' },
    { ref: 'Philippians 4:13', text: 'I can do all things through Christ who strengthens me.', color: 'var(--hl-clay)' },
    { ref: 'Matthew 11:28', text: 'Come to me, all you who labor and are heavily burdened, and I will give you rest.', color: 'var(--hl-pink)' },
    { ref: 'Proverbs 3:5', text: 'Trust in the LORD with all your heart, and don’t lean on your own understanding.', color: 'var(--hl-green)' },
    { ref: 'John 8:12', text: 'I am the light of the world. He who follows me will have the light of life.', color: 'var(--hl-yellow)' },
    { ref: '2 Corinthians 12:9', text: 'My grace is sufficient for you, for my power is made perfect in weakness.', color: 'var(--hl-blue)' },
  ],
  bookmarks: [
    { ref: 'John 1:1', text: 'In the beginning was the Word, and the Word was with God, and the Word was God.' },
    { ref: 'Genesis 1:1', text: 'In the beginning, God created the heavens and the earth.' },
    { ref: 'Psalm 1:1', text: 'Blessed is the man who doesn’t walk in the counsel of the wicked.' },
    { ref: 'John 3:16', text: 'For God so loved the world, that he gave his one and only Son.' },
    { ref: 'Romans 12:2', text: 'Don’t be conformed to this world, but be transformed by the renewing of your mind.' },
    { ref: 'Ephesians 2:8', text: 'For by grace you have been saved through faith, and that not of yourselves.' },
    { ref: 'Revelation 21:4', text: 'He will wipe away every tear from their eyes. Death will be no more.' },
  ],
  notes: [
    { ref: 'John 1:4', date: 'Today', text: 'Life and light keep showing up together in John. The life comes first.' },
    { ref: 'John 1:14', date: 'Yesterday', text: '“Dwelt” = tabernacled. God pitching his tent among us.' },
    { ref: 'Psalm 23:1', date: 'May 28', text: 'If the LORD is my shepherd, then what I lack isn’t a sign he’s absent.' },
    { ref: 'Romans 8:1', date: 'May 24', text: 'No condemnation — present tense, already true of me now.' },
    { ref: 'Matthew 5:14', date: 'May 20', text: 'Light isn’t something I generate; it’s something I reflect.' },
    { ref: 'Philippians 4:6', date: 'May 18', text: 'The antidote to anxiety here is prayer with thanksgiving.' },
  ],
  crossrefs: [
    { ref: 'John 1:1', text: 'Genesis 1:1 · 1 John 1:1 · Revelation 19:13' },
    { ref: 'John 1:14', text: 'Exodus 33:18 · Colossians 2:9 · Hebrews 1:3' },
    { ref: 'John 1:4', text: 'John 8:12 · 1 John 1:5 · Psalm 36:9' },
    { ref: 'Romans 8:28', text: 'Genesis 50:20 · Ephesians 1:11' },
    { ref: 'Psalm 23:1', text: 'John 10:11 · Isaiah 40:11 · Ezekiel 34:15' },
  ],
};

// ── reading content for the Books module (public-domain openings) ──
const BOOK_TEXT = {
  pilgrim: {
    year: '1678', pages: 312,
    blurb: 'An allegory of the Christian life, told as a dream of one man’s journey from the City of Destruction to the Celestial City.',
    chapter: 'The First Stage',
    body: [
      'As I walked through the wilderness of this world, I lighted on a certain place where was a den, and laid me down in that place to sleep; and as I slept, I dreamed a dream.',
      'I dreamed, and behold, I saw a man clothed with rags standing in a certain place, with his face from his own house, a book in his hand, and a great burden upon his back. I looked, and saw him open the book, and read therein; and as he read, he wept and trembled.',
      'Not being able longer to contain, he brake out with a lamentable cry, saying, “What shall I do?” In this plight, therefore, he went home and refrained himself as long as he could, that his wife and children should not perceive his distress; but he could not be silent long.',
      'At last he brake his mind to his wife and children; and thus he began to talk to them: “O my dear wife, and you the children of my bowels, I, your dear friend, am in myself undone by reason of a burden that lieth hard upon me.”',
    ],
  },
  paradise: {
    year: '1667', pages: 458, verse: true,
    blurb: 'Milton’s epic in blank verse on the fall of man — the rebellion of Satan, the temptation in Eden, and the loss of paradise.',
    chapter: 'Book I',
    body: [
      'Of Man’s first disobedience, and the fruit\nOf that forbidden tree whose mortal taste\nBrought death into the World, and all our woe,\nWith loss of Eden, till one greater Man\nRestore us, and regain the blissful seat,\nSing, Heavenly Muse, that, on the secret top\nOf Oreb, or of Sinai, didst inspire\nThat shepherd who first taught the chosen seed.',
      'And chiefly Thou, O Spirit, that dost prefer\nBefore all temples the upright heart and pure,\nInstruct me, for Thou know’st; Thou from the first\nWast present, and, with mighty wings outspread,\nDove-like sat’st brooding on the vast Abyss,\nAnd mad’st it pregnant.',
      'What in me is dark\nIllumine, what is low raise and support;\nThat, to the height of this great argument,\nI may assert Eternal Providence,\nAnd justify the ways of God to men.',
    ],
  },
  holywar: {
    year: '1682', pages: 276,
    blurb: 'Bunyan’s allegory of the town of Mansoul, besieged and reclaimed — the soul as a city contested between Diabolus and the King’s Son.',
    chapter: 'The Town of Mansoul',
    body: [
      'In my travels, as I walked through many regions and countries, it was my chance to happen into that famous continent of Universe. A very large and spacious country it is: it lieth between the two poles, and just amidst the four points of the heavens.',
      'In this country there is a fair and delicate town, a corporation, called Mansoul; a town for its building so curious, for its situation so commodious, for its privileges so advantageous, that I may say of it, there is not its equal under the whole heaven.',
      'The walls of the town were well built, yea, so fast and firm were they knit and compact together, that, had it not been for the townsmen themselves, they could not have been shaken or broken for ever.',
    ],
  },
  confessions: {
    year: '397', pages: 416,
    blurb: 'Augustine’s autobiography and prayer — the restless search of a soul for God, written as one long address to his Maker.',
    chapter: 'Book I',
    body: [
      'Great art Thou, O Lord, and greatly to be praised; great is Thy power, and of Thy wisdom there is no end. And man, being a part of Thy creation, desires to praise Thee — man, who bears about with him his mortality, the witness of his sin.',
      'Yet would man praise Thee; he, but a particle of Thy creation. Thou awakest us to delight in Thy praise; for Thou madest us for Thyself, and our heart is restless, until it repose in Thee.',
      'Grant me, Lord, to know and understand which is first — to call on Thee, or to praise Thee; and, again, to know Thee, or to call on Thee. But who there is that calls on Thee, not knowing Thee?',
    ],
  },
  grace: {
    year: '1666', pages: 168,
    blurb: 'Bunyan’s spiritual autobiography — the account of a tinker’s conversion, doubts, and the grace that abounded to the chief of sinners.',
    chapter: 'A Preface',
    body: [
      'In this my relation of the merciful working of God upon my soul, it will not be amiss, if in the first place, I do in a few words give you a hint of my pedigree and manner of bringing up; that thereby the goodness and bounty of God towards me may be the more advanced.',
      'For my descent, then, it was, as is well known by many, of a low and inconsiderable generation; my father’s house being of that rank that is meanest and most despised of all the families in the land.',
      'Nevertheless, I bless God that by this door He brought me into the world, to partake of the grace and life that is in Christ by the gospel.',
    ],
  },
  martyrs: {
    year: '1563', pages: 524,
    blurb: 'Foxe’s history of the persecutions of the Christian church, from the early martyrs to the reformers of his own age.',
    chapter: 'The Primitive Church',
    body: [
      'Christ our Saviour, in the Gospel of St. Matthew, hearing the confession of Simon Peter, answered and said, “Upon this rock I will build my Church, and the gates of hell shall not prevail against it,” in which words three things are to be noted.',
      'First, that Christ will have a Church in this world. Secondly, that the same Church should mightily be impugned, not only by the world, but also by the uttermost strength and powers of all hell. And thirdly, that the same Church, notwithstanding, should continue.',
      'Which prophecy of Christ we see wonderfully to be verified, insomuch that the whole course of the Church to this day may seem nothing else but a verifying of the said prophecy.',
    ],
  },
  imitation: {
    year: '1418', pages: 196,
    blurb: 'À Kempis’s manual of devotion — counsel on the inner life, humility, and the following of Christ above all things.',
    chapter: 'Of the Imitation of Christ',
    body: [
      '“He that followeth Me shall not walk in darkness,” saith the Lord. These are the words of Christ, by which we are taught how we ought to imitate His life and manners, if we would be truly enlightened, and be delivered from all blindness of heart.',
      'Let it be our chiefest study to meditate upon the life of Jesus Christ. The teaching of Christ surpasseth all the teaching of holy men; and he that hath the Spirit will find therein a hidden manna.',
      'What doth it profit thee to enter into deep discussion concerning the Holy Trinity, if thou lack humility, and be thus displeasing to the Trinity? Verily, high words make not a man holy and just; but a virtuous life maketh him dear to God.',
    ],
  },
  presence: {
    year: '1692', pages: 96,
    blurb: 'The collected conversations and letters of Brother Lawrence, a kitchen monk who learned to commune with God in the smallest tasks.',
    chapter: 'The First Conversation',
    body: [
      'He told me that the first time he saw Brother Lawrence, he found him a man of about sixty years of age, of a clownish kind, who had a great inclination to do nothing but love and serve God.',
      'That he had been converted at the age of eighteen, in the winter, upon seeing a tree stripped of its leaves, and considering that within a little time the leaves would be renewed, and after that the flowers and fruit appear. He received a high view of the providence and power of God, which has never since been effaced from his soul.',
      'That we ought to give ourselves up to God with regard both to things temporal and spiritual, and seek our satisfaction only in the fulfilling of His will, whether He lead us by suffering or by consolation.',
    ],
  },
  interior: {
    year: '1577', pages: 248,
    blurb: 'Teresa of Ávila’s map of the soul as a crystal castle of many rooms, drawing the reader inward toward union with God.',
    chapter: 'The First Mansions',
    body: [
      'While beseeching our Lord to speak for me, because I could think of nothing to say nor knew how to begin to carry out this obedience, there came to my mind what I shall now speak about, to lay a foundation.',
      'I began to think of the soul as if it were a castle made of a single diamond or of very clear crystal, in which there are many rooms, just as in heaven there are many mansions.',
      'Now if we consider it carefully, the soul of the just is nothing else than a paradise where, as God tells us, He takes His delight. What, then, must that dwelling be in which a King so mighty, so wise, so pure, so full of all good things, takes His delight?',
    ],
  },
  institutes: {
    year: '1536', pages: 612,
    blurb: 'Calvin’s systematic theology — the knowledge of God and of ourselves set out for the instruction of the faithful.',
    chapter: 'The Knowledge of God and of Ourselves',
    body: [
      'Nearly all the wisdom we possess, that is to say, true and sound wisdom, consists of two parts: the knowledge of God and of ourselves. But, while joined by many bonds, which one precedes and brings forth the other is not easy to discern.',
      'In the first place, no man can survey himself without forthwith turning his thoughts towards the God in whom he lives and moves; because it is perfectly obvious that the endowments which we possess cannot possibly be from ourselves.',
      'On the other hand, it is evident that man never attains to a true self-knowledge until he have previously contemplated the face of God, and come down after such contemplation to look into himself.',
    ],
  },
  cityofgod: {
    year: '426', pages: 698,
    blurb: 'Augustine’s great work on the two cities — the City of God and the city of man — written as Rome fell to the Goths.',
    chapter: 'Book I · The Two Cities',
    body: [
      'The glorious city of God is my theme in this work, which you, my dearest son Marcellinus, suggested, and which is due to you by my promise. I have undertaken its defence against those who prefer their own gods to the Founder of this city.',
      'A city surpassingly glorious, whether we view it as it still lives by faith in this fleeting course of time, and sojourns as a stranger in the midst of the ungodly, or as it shall dwell in the fixed stability of its eternal seat.',
      'The earthly city glories in itself, the heavenly city glories in the Lord. The one seeks glory from men; but the greatest glory of the other is God, the witness of conscience.',
    ],
  },
  orthodoxy: {
    year: '1908', pages: 184,
    blurb: 'Chesterton’s witty defence of the Christian faith as the answer to the deepest puzzles of the human heart.',
    chapter: 'Introduction in Defence of Everything Else',
    body: [
      'I have often had a fancy for writing a romance about an English yachtsman who slightly miscalculated his course and discovered England under the impression that it was a new island in the South Seas.',
      'There will probably be a general impression that the man who landed (armed to the teeth and talking by signs) to plant the British flag on that barbaric temple which turned out to be the Pavilion at Brighton, felt rather a fool.',
      'What could be more delightful than to have in the same few minutes all the fascinating terrors of going abroad combined with all the humane security of coming home again? This at least seems to me the main problem for philosophers.',
    ],
  },
  pensees: {
    year: '1670', pages: 356,
    blurb: 'Pascal’s scattered notes toward a defence of the faith — fragments on the greatness and wretchedness of man.',
    chapter: 'Thoughts on Man',
    body: [
      'Man is but a reed, the most feeble thing in nature; but he is a thinking reed. The entire universe need not arm itself to crush him. A vapour, a drop of water suffices to kill him.',
      'But, if the universe were to crush him, man would still be more noble than that which killed him, because he knows that he dies and the advantage which the universe has over him; the universe knows nothing of this.',
      'All our dignity consists, then, in thought. By it we must elevate ourselves, and not by space and time which we cannot fill. Let us endeavour, then, to think well; this is the principle of morality.',
    ],
  },
};

// members for the "view a member" card (tapped from a chat bubble)
const MEMBERS = {};   // no sample member directory — real members come from chat participation

// ── Notifications + Listen (audio) ──
const NOTIFICATIONS = [];   // no seeded notifications

const LISTEN = { now: null, queue: [] };   // no seeded audio

window.TrinityData = {
  BOOKS, LEXICON, CONCORDANCE, TAGS, CROSSREFS, COMMENTARY, DEVOTIONAL, VOTD, VOTD_POOL,
  PLANS, MODULES, MODULE_ITEMS, COLLECTIONS, COLLECTION_ITEMS, BOOK_TEXT, JOURNAL, PRAYER_SEED, SEARCH_SEED, SEARCH_RESULTS,
  VIDEO_CATS, CHANNELS, VIDEOS, NOTIFICATIONS, LISTEN, MEMBERS,
  HANDLE_POOL, AVATAR_COLORS, AVATAR_SYMBOLS, CHAT_IDENTITY, RELAYS, CHURCHES, GROUPS, GROUP_MESSAGES,
  SATS_PER_USD, CURRENCIES, WALLET, FUNDS, STRIKE_PRESETS, GIVING_HISTORY,
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
