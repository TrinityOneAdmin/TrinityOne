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
  // ── the original 14 references (text updated to WEB) ──
  { ref: 'John 1:5', text: 'The light shines in the darkness, and the darkness hasn\'t overcome it.' },
  { ref: 'Psalms 23:1', text: 'Yahweh is my shepherd: I shall lack nothing.' },
  { ref: 'Proverbs 3:5', text: 'Trust in Yahweh with all your heart, and don\'t lean on your own understanding.' },
  { ref: 'Isaiah 41:10', text: 'Don\'t you be afraid, for I am with you. Don\'t be dismayed, for I am your God. I will strengthen you. Yes, I will help you. Yes, I will uphold you with the right hand of my righteousness.' },
  { ref: 'Philippians 4:6', text: 'In nothing be anxious, but in everything, by prayer and petition with thanksgiving, let your requests be made known to God.' },
  { ref: 'Romans 8:28', text: 'We know that all things work together for good for those who love God, to those who are called according to his purpose.' },
  { ref: 'Matthew 11:28', text: 'Come to me, all you who labor and are heavily burdened, and I will give you rest.' },
  { ref: 'Psalms 46:1', text: 'God is our refuge and strength, a very present help in trouble.' },
  { ref: 'Joshua 1:9', text: 'Haven\'t I commanded you? Be strong and courageous. Don\'t be afraid. Don\'t be dismayed, for Yahweh your God is with you wherever you go.' },
  { ref: 'Lamentations 3:22', text: 'It is because of Yahweh\'s loving kindnesses that we are not consumed, because his compassion doesn\'t fail.' },
  { ref: 'John 14:27', text: 'Peace I leave with you. My peace I give to you; not as the world gives, give I to you. Don\'t let your heart be troubled, neither let it be fearful.' },
  { ref: '2 Corinthians 5:17', text: 'Therefore if anyone is in Christ, he is a new creation. The old things have passed away. Behold, all things have become new.' },
  { ref: 'Psalms 119:105', text: 'Your word is a lamp to my feet, and a light for my path.' },
  { ref: 'Hebrews 13:8', text: 'Jesus Christ is the same yesterday, today, and forever.' },

  // ── most popular / most important ──
  { ref: 'John 3:16', text: 'For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.' },
  { ref: 'Romans 6:23', text: 'For the wages of sin is death, but the free gift of God is eternal life in Christ Jesus our Lord.' },
  { ref: 'Philippians 4:13', text: 'I can do all things through Christ, who strengthens me.' },
  { ref: 'Romans 3:23', text: 'For all have sinned, and fall short of the glory of God.' },
  { ref: 'John 14:6', text: 'Jesus said to him, "I am the way, the truth, and the life. No one comes to the Father, except through me."' },
  { ref: 'Jeremiah 29:11', text: 'For I know the thoughts that I think toward you," says Yahweh, "thoughts of peace, and not of evil, to give you hope and a future.' },
  { ref: '1 Corinthians 10:13', text: 'No temptation has taken you except what is common to man. God is faithful, who will not allow you to be tempted above what you are able, but will with the temptation also make the way of escape, that you may be able to endure it.' },
  { ref: 'Matthew 6:33', text: 'But seek first God\'s Kingdom and his righteousness; and all these things will be given to you as well.' },
  { ref: 'Hebrews 4:16', text: 'Let\'s therefore draw near with boldness to the throne of grace, that we may receive mercy and may find grace for help in time of need.' },
  { ref: '2 Timothy 3:16', text: 'Every Scripture is God-breathed and profitable for teaching, for reproof, for correction, and for instruction in righteousness.' },
  { ref: 'Ephesians 2:8', text: 'For by grace you have been saved through faith, and that not of yourselves; it is the gift of God.' },
  { ref: 'Galatians 2:20', text: 'I have been crucified with Christ, and it is no longer I who live, but Christ lives in me. That life which I now live in the flesh, I live by faith in the Son of God, who loved me and gave himself up for me.' },
  { ref: 'Romans 10:17', text: 'So faith comes by hearing, and hearing by the word of God.' },
  { ref: 'Romans 10:9', text: 'That if you will confess with your mouth that Jesus is Lord, and believe in your heart that God raised him from the dead, you will be saved.' },
  { ref: 'Micah 6:8', text: 'He has shown you, O man, what is good. What does Yahweh require of you, but to act justly, to love mercy, and to walk humbly with your God?' },
  { ref: 'Psalms 37:4', text: 'Also delight yourself in Yahweh, and he will give you the desires of your heart.' },
  { ref: 'Revelation 21:4', text: 'He will wipe away every tear from their eyes. Death will be no more; neither will there be mourning, nor crying, nor pain any more. The first things have passed away.' },
  { ref: 'James 5:16', text: 'Confess your sins to one another, and pray for one another, that you may be healed. The insistent prayer of a righteous person is powerfully effective.' },
  { ref: 'Philippians 4:19', text: 'My God will supply every need of yours according to his riches in glory in Christ Jesus.' },
  { ref: 'Philippians 4:8', text: 'Finally, brothers, whatever things are true, whatever things are honorable, whatever things are just, whatever things are pure, whatever things are lovely, whatever things are of good report: if there is any virtue and if there is anything worthy of praise, think about these things.' },
  { ref: 'Galatians 5:22', text: 'But the fruit of the Spirit is love, joy, peace, patience, kindness, goodness, faith.' },
  { ref: 'Romans 5:8', text: 'But God commends his own love toward us, in that while we were yet sinners, Christ died for us.' },
  { ref: 'John 1:1', text: 'In the beginning was the Word, and the Word was with God, and the Word was God.' },
  { ref: 'Matthew 28:19', text: 'Go and make disciples of all nations, baptizing them in the name of the Father and of the Son and of the Holy Spirit.' },
  { ref: 'Isaiah 40:31', text: 'But those who wait for Yahweh will renew their strength. They will mount up with wings like eagles. They will run, and not be weary. They will walk, and not faint.' },
  { ref: 'Isaiah 26:3', text: 'You will keep whoever\'s mind is steadfast in perfect peace, because he trusts in you.' },
  { ref: 'Isaiah 9:6', text: 'For a child is born to us. A son is given to us; and the government will be on his shoulders. His name will be called Wonderful Counselor, Mighty God, Everlasting Father, Prince of Peace.' },
  { ref: 'Proverbs 3:6', text: 'In all your ways acknowledge him, and he will make your paths straight.' },
  { ref: '1 John 4:7', text: 'Beloved, let\'s love one another, for love is from God; and everyone who loves has been born of God and knows God.' },
  { ref: '1 Peter 2:24', text: 'He himself bore our sins in his body on the tree, that we, having died to sins, might live to righteousness. You were healed by his wounds.' },
  { ref: 'James 4:7', text: 'Be subject therefore to God. Resist the devil, and he will flee from you.' },
  { ref: 'James 1:17', text: 'Every good gift and every perfect gift is from above, coming down from the Father of lights, with whom can be no variation nor turning shadow.' },
  { ref: 'Hebrews 11:6', text: 'Without faith it is impossible to be well pleasing to him, for he who comes to God must believe that he exists, and that he is a rewarder of those who seek him.' },
  { ref: 'Hebrews 11:1', text: 'Now faith is assurance of things hoped for, proof of things not seen.' },
  { ref: 'Hebrews 10:25', text: 'Not forsaking our own assembling together, as the custom of some is, but exhorting one another, and so much the more as you see the Day approaching.' },
  { ref: '2 Timothy 1:7', text: 'For God didn\'t give us a spirit of fear, but of power, love, and self-control.' },
  { ref: '1 Thessalonians 5:18', text: 'In everything give thanks, for this is the will of God in Christ Jesus toward you.' },
  { ref: 'Colossians 3:23', text: 'Whatever you do, work heartily, as for the Lord and not for men.' },
  { ref: 'Philippians 1:6', text: 'Being confident of this very thing, that he who began a good work in you will complete it until the day of Jesus Christ.' },
  { ref: 'Ephesians 4:32', text: 'And be kind to one another, tender hearted, forgiving each other, just as God also in Christ forgave you.' },
  { ref: 'Ephesians 4:29', text: 'Let no corrupt speech proceed out of your mouth, but only what is good for building others up as the need may be, that it may give grace to those who hear.' },
  { ref: 'Ephesians 3:20', text: 'Now to him who is able to do exceedingly abundantly above all that we ask or think, according to the power that works in us.' },
  { ref: 'Ephesians 2:10', text: 'For we are his workmanship, created in Christ Jesus for good works, which God prepared before that we would walk in them.' },
  { ref: '2 Corinthians 12:9', text: 'He has said to me, "My grace is sufficient for you, for my power is made perfect in weakness." Most gladly therefore I will rather glory in my weaknesses, that the power of Christ may rest on me.' },
  { ref: '1 Corinthians 10:31', text: 'Whether therefore you eat or drink, or whatever you do, do all to the glory of God.' },
  { ref: 'Romans 12:2', text: 'Don\'t be conformed to this world, but be transformed by the renewing of your mind, so that you may prove what is the good, well-pleasing, and perfect will of God.' },
  { ref: 'Romans 12:1', text: 'Therefore I urge you, brothers, by the mercies of God, to present your bodies a living sacrifice, holy, acceptable to God, which is your spiritual service.' },
  { ref: 'Romans 8:1', text: 'There is therefore now no condemnation to those who are in Christ Jesus.' },
  { ref: 'Acts 4:12', text: 'There is salvation in no one else, for there is no other name under heaven that is given among men, by which we must be saved!' },
  { ref: 'John 15:13', text: 'Greater love has no one than this, that someone lay down his life for his friends.' },
  { ref: 'John 10:10', text: 'The thief only comes to steal, kill, and destroy. I came that they may have life, and may have it abundantly.' },
  { ref: 'John 8:32', text: 'You will know the truth, and the truth will make you free.' },
  { ref: 'John 1:12', text: 'But as many as received him, to them he gave the right to become God\'s children, to those who believe in his name.' },
  { ref: 'Matthew 28:20', text: 'Teaching them to observe all things that I commanded you. Behold, I am with you always, even to the end of the age.' },
  { ref: 'Matthew 7:12', text: 'Therefore whatever you desire for men to do to you, you shall also do to them; for this is the law and the prophets.' },
  { ref: 'Matthew 5:16', text: 'Even so, let your light shine before men, that they may see your good works and glorify your Father who is in heaven.' },

  // ── encouragement ──
  { ref: 'John 16:33', text: 'I have told you these things, that in me you may have peace. In the world you have trouble; but cheer up! I have overcome the world.' },
  { ref: '1 Thessalonians 5:11', text: 'Therefore exhort one another, and build each other up, even as you also do.' },
  { ref: 'Psalms 31:24', text: 'Be strong, and let your heart take courage, all you who hope in Yahweh.' },
  { ref: '1 Corinthians 15:58', text: 'Therefore, my beloved brothers, be steadfast, immovable, always abounding in the Lord\'s work, because you know that your labor is not in vain in the Lord.' },
  { ref: '1 Corinthians 16:13', text: 'Watch! Stand firm in the faith! Be courageous! Be strong!' },
  { ref: 'Romans 15:4', text: 'For whatever things were written before were written for our learning, that through perseverance and through encouragement of the Scriptures we might have hope.' },
  { ref: 'Isaiah 43:2', text: 'When you pass through the waters, I will be with you, and through the rivers, they will not overflow you. When you walk through the fire, you will not be burned, and the flame will not scorch you.' },
  { ref: 'Psalms 23:4', text: 'Even though I walk through the valley of the shadow of death, I will fear no evil, for you are with me. Your rod and your staff, they comfort me.' },
  { ref: 'Deuteronomy 31:6', text: 'Be strong and courageous. Don\'t be afraid or scared of them, for Yahweh your God himself is who goes with you. He will not fail you nor forsake you.' },
  { ref: 'Psalms 34:4', text: 'I sought Yahweh, and he answered me, and delivered me from all my fears.' },
  { ref: 'Psalms 32:8', text: 'I will instruct you and teach you in the way which you shall go. I will counsel you with my eye on you.' },
  { ref: 'Psalms 28:7', text: 'Yahweh is my strength and my shield. My heart has trusted in him, and I am helped. Therefore my heart greatly rejoices. With my song I will thank him.' },
  { ref: 'Romans 8:31', text: 'What then shall we say about these things? If God is for us, who can be against us?' },
  { ref: 'Deuteronomy 31:8', text: 'Yahweh himself is who goes before you. He will be with you. He will not fail you nor forsake you. Don\'t be afraid. Don\'t be dismayed.' },
  { ref: 'Psalms 55:22', text: 'Cast your burden on Yahweh and he will sustain you. He will never allow the righteous to be moved.' },
  { ref: '2 Corinthians 4:17', text: 'For our light affliction, which is for the moment, works for us more and more exceedingly an eternal weight of glory.' },
  { ref: 'Psalms 27:1', text: 'Yahweh is my light and my salvation. Whom shall I fear? Yahweh is the strength of my life. Of whom shall I be afraid?' },
  { ref: 'Isaiah 12:2', text: 'Behold, God is my salvation. I will trust, and will not be afraid; for Yah, Yahweh, is my strength and song; and he has become my salvation.' },

  // ── hope ──
  { ref: 'Romans 15:13', text: 'Now may the God of hope fill you with all joy and peace in believing, that you may abound in hope in the power of the Holy Spirit.' },
  { ref: 'Romans 12:12', text: 'Rejoicing in hope, enduring in troubles, continuing steadfastly in prayer.' },
  { ref: '1 Peter 1:3', text: 'Blessed be the God and Father of our Lord Jesus Christ, who according to his great mercy became our father again to a living hope through the resurrection of Jesus Christ from the dead.' },
  { ref: 'Colossians 1:27', text: 'To whom God was pleased to make known what are the riches of the glory of this mystery among the Gentiles, which is Christ in you, the hope of glory.' },
  { ref: 'Romans 5:5', text: 'And hope doesn\'t disappoint us, because God\'s love has been poured into our hearts through the Holy Spirit who was given to us.' },
  { ref: '1 Corinthians 13:13', text: 'But now faith, hope, and love remain — these three. The greatest of these is love.' },
  { ref: 'Hebrews 10:23', text: 'Let\'s hold fast the confession of our hope without wavering; for he who promised is faithful.' },
  { ref: 'Psalms 33:22', text: 'Let your loving kindness be on us, Yahweh, since we have hoped in you.' },
  { ref: 'Psalms 42:11', text: 'Why are you in despair, my soul? Why are you disturbed within me? Hope in God! For I shall still praise him, the saving help of my countenance, and my God.' },
  { ref: 'Zephaniah 3:17', text: 'Yahweh, your God, is among you, a mighty one who will save. He will rejoice over you with joy. He will calm you in his love. He will rejoice over you with singing.' },
  { ref: 'Psalms 71:5', text: 'For you are my hope, Lord Yahweh, my confidence from my youth.' },
  { ref: 'Psalms 130:5', text: 'I wait for Yahweh. My soul waits. I hope in his word.' },
  { ref: 'Lamentations 3:24', text: '"Yahweh is my portion," says my soul. "Therefore I will hope in him."' },
  { ref: 'Jeremiah 17:7', text: 'Blessed is the man who trusts in Yahweh, and whose confidence is in Yahweh.' },
  { ref: 'Psalms 71:14', text: 'But I will always hope, and will add to all of your praise.' },
  { ref: 'Hebrews 6:19', text: 'This hope we have as an anchor of the soul, a hope both sure and steadfast and entering into that which is within the veil.' },

  // ── comfort ──
  { ref: 'Psalms 119:76', text: 'Please let your loving kindness be for my comfort, according to your word to your servant.' },
  { ref: 'Matthew 5:4', text: 'Blessed are those who mourn, for they shall be comforted.' },
  { ref: 'Psalms 119:50', text: 'This is my comfort in my affliction, for your word has revived me.' },
  { ref: 'Psalms 147:3', text: 'He heals the broken in heart, and binds up their wounds.' },
  { ref: 'Psalms 34:18', text: 'Yahweh is near to those who have a broken heart, and saves those who have a crushed spirit.' },
  { ref: 'Isaiah 66:13', text: 'As one whom his mother comforts, so I will comfort you. You will be comforted in Jerusalem.' },
  { ref: 'Psalms 30:5', text: 'For his anger is but for a moment. His favor is for a lifetime. Weeping may stay for the night, but joy comes in the morning.' },
  { ref: 'Nahum 1:7', text: 'Yahweh is good, a stronghold in the day of trouble, and he knows those who take refuge in him.' },
  { ref: 'John 14:1', text: 'Don\'t let your heart be troubled. Believe in God. Believe also in me.' },
  { ref: 'Psalms 73:26', text: 'My flesh and my heart fails, but God is the strength of my heart and my portion forever.' },
  { ref: 'Psalms 23:6', text: 'Surely goodness and loving kindness shall follow me all the days of my life, and I will dwell in Yahweh\'s house forever.' },

  // ── peace ──
  { ref: '2 Thessalonians 3:16', text: 'Now may the Lord of peace himself give you peace at all times in all ways. The Lord be with you all.' },
  { ref: 'Psalms 4:8', text: 'In peace I will both lay myself down and sleep, for you alone, Yahweh, make me live in safety.' },
  { ref: 'Colossians 3:15', text: 'And let the peace of God rule in your hearts, to which also you were called in one body, and be thankful.' },
  { ref: 'Romans 12:18', text: 'If it is possible, as much as it is up to you, be at peace with all men.' },
  { ref: '1 Peter 5:7', text: 'Casting all your worries on him, because he cares for you.' },
  { ref: 'Philippians 4:7', text: 'And the peace of God, which surpasses all understanding, will guard your hearts and your thoughts in Christ Jesus.' },
  { ref: 'Romans 5:1', text: 'Being therefore justified by faith, we have peace with God through our Lord Jesus Christ.' },
  { ref: 'Psalms 29:11', text: 'Yahweh will give strength to his people. Yahweh will bless his people with peace.' },
  { ref: 'Isaiah 54:10', text: '"For the mountains may depart, and the hills be removed, but my loving kindness will not depart from you, and my covenant of peace will not be removed," says Yahweh who has mercy on you.' },
  { ref: 'Philippians 4:9', text: 'The things which you learned, received, heard, and saw in me: do these things, and the God of peace will be with you.' },
  { ref: 'Isaiah 52:7', text: 'How beautiful on the mountains are the feet of him who brings good news, who publishes peace, who brings good news, who publishes salvation, who says to Zion, "Your God reigns!"' },

  // ── joy ──
  { ref: 'Philippians 4:4', text: 'Rejoice in the Lord always! Again I will say, "Rejoice!"' },
  { ref: 'James 1:2', text: 'Count it all joy, my brothers, when you fall into various temptations.' },
  { ref: 'Psalms 16:11', text: 'You will show me the path of life. In your presence is fullness of joy. In your right hand there are pleasures forever more.' },
  { ref: 'John 16:24', text: 'Until now, you have asked nothing in my name. Ask, and you will receive, that your joy may be made full.' },
  { ref: 'Proverbs 17:22', text: 'A cheerful heart makes good medicine, but a crushed spirit dries up the bones.' },
  { ref: 'John 15:11', text: 'I have spoken these things to you, that my joy may remain in you, and that your joy may be made full.' },
  { ref: 'Psalms 118:24', text: 'This is the day that Yahweh has made. We will rejoice and be glad in it!' },
  { ref: 'Nehemiah 8:10', text: 'Then he said to them, "Go your way. Eat the fat, drink the sweet, and send portions to him for whom nothing is prepared, for today is holy to our Lord. Don\'t be grieved, for the joy of Yahweh is your strength."' },
  { ref: '1 Thessalonians 5:16', text: 'Always rejoice.' },
  { ref: 'Psalms 32:11', text: 'Be glad in Yahweh, and rejoice, you righteous! Shout for joy, all you who are upright in heart!' },
  { ref: 'Isaiah 61:10', text: 'I will greatly rejoice in Yahweh! My soul will be joyful in my God, for he has clothed me with the garments of salvation. He has covered me with the robe of righteousness.' },
  { ref: 'Psalms 126:5', text: 'Those who sow in tears will reap in joy.' },
  { ref: 'Romans 14:17', text: 'For God\'s Kingdom is not eating and drinking, but righteousness, peace, and joy in the Holy Spirit.' },

  // ── love ──
  { ref: '1 Corinthians 16:14', text: 'Let all that you do be done in love.' },
  { ref: '1 John 4:8', text: 'He who doesn\'t love doesn\'t know God, for God is love.' },
  { ref: '1 Peter 4:8', text: 'And above all things be earnest in your love among yourselves, for love covers a multitude of sins.' },
  { ref: 'Colossians 3:14', text: 'Above all these things, walk in love, which is the bond of perfection.' },
  { ref: 'Proverbs 10:12', text: 'Hatred stirs up strife, but love covers all wrongs.' },
  { ref: '1 John 4:18', text: 'There is no fear in love; but perfect love casts out fear, because fear has punishment. He who fears is not made perfect in love.' },
  { ref: '1 John 4:19', text: 'We love him, because he first loved us.' },
  { ref: 'Romans 12:9', text: 'Let love be without hypocrisy. Abhor that which is evil. Cling to that which is good.' },
  { ref: 'Romans 12:10', text: 'In love of the brothers be tenderly affectionate to one another; in honor preferring one another.' },
  { ref: 'Romans 13:10', text: 'Love doesn\'t harm a neighbor. Love therefore is the fulfillment of the law.' },
  { ref: '1 John 3:18', text: 'My little children, let\'s not love in word only, or with the tongue only, but in deed and truth.' },
  { ref: 'John 15:12', text: 'This is my commandment, that you love one another, even as I have loved you.' },
  { ref: 'John 13:34', text: 'A new commandment I give to you, that you love one another. Just as I have loved you, you also love one another.' },
  { ref: 'Deuteronomy 7:9', text: 'Know therefore that Yahweh your God himself is God, the faithful God, who keeps covenant and loving kindness to a thousand generations with those who love him and keep his commandments.' },
  { ref: 'Matthew 22:37', text: 'Jesus said to him, "You shall love the Lord your God with all your heart, with all your soul, and with all your mind."' },

  // ── gratitude ──
  { ref: 'Colossians 3:17', text: 'Whatever you do, in word or in deed, do all in the name of the Lord Jesus, giving thanks to God the Father through him.' },
  { ref: 'Psalms 136:1', text: 'Give thanks to Yahweh, for he is good, for his loving kindness endures forever.' },
  { ref: 'Psalms 107:1', text: 'Give thanks to Yahweh, for he is good, for his loving kindness endures forever.' },
  { ref: 'Ephesians 5:20', text: 'Giving thanks always concerning all things in the name of our Lord Jesus Christ to God, even the Father.' },
  { ref: 'Psalms 100:4', text: 'Enter into his gates with thanksgiving, and into his courts with praise. Give thanks to him, and bless his name.' },
  { ref: '1 Chronicles 16:34', text: 'Oh give thanks to Yahweh, for he is good, for his loving kindness endures forever.' },
  { ref: 'Colossians 4:2', text: 'Continue steadfastly in prayer, watching in it with thanksgiving.' },
  { ref: 'Hebrews 13:15', text: 'Through him, then, let\'s offer up a sacrifice of praise to God continually, that is, the fruit of lips which confess his name.' },

  // ── forgiveness ──
  { ref: 'Mark 11:25', text: 'Whenever you stand praying, forgive, if you have anything against anyone; so that your Father, who is in heaven, may also forgive you your transgressions.' },
  { ref: '1 John 1:9', text: 'If we confess our sins, he is faithful and righteous to forgive us the sins and to cleanse us from all unrighteousness.' },
  { ref: 'Colossians 3:13', text: 'Bearing with one another, and forgiving each other, if any man has a complaint against any; even as Christ forgave you, so you also do.' },
  { ref: 'Luke 6:37', text: 'Don\'t judge, and you won\'t be judged. Don\'t condemn, and you won\'t be condemned. Set free, and you will be set free.' },
  { ref: 'Ephesians 1:7', text: 'In him we have our redemption through his blood, the forgiveness of our trespasses, according to the riches of his grace.' },
  { ref: 'Psalms 103:12', text: 'As far as the east is from the west, so far has he removed our transgressions from us.' },
  { ref: 'Proverbs 28:13', text: 'He who conceals his sins doesn\'t prosper, but whoever confesses and renounces them finds mercy.' },
  { ref: 'Isaiah 1:18', text: '"Come now, and let\'s reason together," says Yahweh: "Though your sins are as scarlet, they shall be as white as snow. Though they are red like crimson, they shall be as wool."' },
  { ref: 'Isaiah 55:7', text: 'Let the wicked forsake his way, and the unrighteous man his thoughts. Let him return to Yahweh, and he will have mercy on him, to our God, for he will freely pardon.' },

  // ── patience and perseverance ──
  { ref: 'Galatians 6:9', text: 'Let\'s not be weary in doing good, for we will reap in due season if we don\'t give up.' },
  { ref: 'Psalms 37:7', text: 'Rest in Yahweh, and wait patiently for him. Don\'t fret because of him who prospers in his way, because of the man who makes wicked plots happen.' },
  { ref: '1 Corinthians 13:4', text: 'Love is patient and is kind. Love doesn\'t envy. Love doesn\'t brag, is not proud.' },
  { ref: 'Colossians 3:12', text: 'Put on therefore, as God\'s chosen ones, holy and beloved, a heart of compassion, kindness, lowliness, humility, and perseverance.' },
  { ref: 'Hebrews 10:36', text: 'For you need endurance so that, having done the will of God, you may receive the promise.' },
  { ref: 'James 1:19', text: 'So, then, my beloved brothers, let every man be swift to hear, slow to speak, and slow to anger.' },
  { ref: 'Psalms 27:14', text: 'Wait for Yahweh. Be strong, and let your heart take courage. Yes, wait for Yahweh.' },
  { ref: 'Psalms 40:1', text: 'I waited patiently for Yahweh. He turned to me, and heard my cry.' },
  { ref: 'James 1:12', text: 'Blessed is a person who endures temptation, for when he has been approved, he will receive the crown of life, which the Lord promised to those who love him.' },
  { ref: 'Hebrews 12:1', text: 'Therefore let\'s also, seeing we are surrounded by so great a cloud of witnesses, lay aside every weight and the sin which so easily entangles us, and let\'s run with perseverance the race that is set before us.' },
  { ref: 'Ecclesiastes 7:8', text: 'Better is the end of a thing than its beginning. The patient in spirit is better than the proud in spirit.' },
  { ref: 'Proverbs 16:32', text: 'One who is slow to anger is better than the mighty; one who rules his spirit, than he who takes a city.' },

  // ── trust and faith ──
  { ref: 'Psalms 56:3', text: 'When I am afraid, I will put my trust in you.' },
  { ref: 'Psalms 9:10', text: 'Those who know your name will put their trust in you, for you, Yahweh, have not forsaken those who seek you.' },
  { ref: 'Psalms 37:5', text: 'Commit your way to Yahweh. Trust also in him, and he will do this.' },
  { ref: 'Psalms 118:8', text: 'It is better to take refuge in Yahweh, than to put confidence in man.' },
  { ref: 'Psalms 112:7', text: 'He will not be afraid of evil news. His heart is steadfast, trusting in Yahweh.' },
  { ref: 'Psalms 37:3', text: 'Trust in Yahweh, and do good. Dwell in the land, and enjoy safe pasture.' },
  { ref: 'Proverbs 29:25', text: 'The fear of man proves to be a snare, but whoever puts his trust in Yahweh is kept safe.' },
  { ref: '2 Corinthians 5:7', text: 'For we walk by faith, not by sight.' },
  { ref: 'Mark 9:23', text: 'Jesus said to him, "If you can believe, all things are possible to him who believes."' },
  { ref: 'Romans 1:16', text: 'For I am not ashamed of the Good News of Christ, because it is the power of God for salvation for everyone who believes, for the Jew first, and also for the Greek.' },

  // ── wisdom ──
  { ref: 'James 1:5', text: 'But if any of you lacks wisdom, let him ask of God, who gives to all liberally and without reproach, and it will be given to him.' },
  { ref: 'Proverbs 1:7', text: 'The fear of Yahweh is the beginning of knowledge, but the foolish despise wisdom and instruction.' },
  { ref: 'Proverbs 2:6', text: 'For Yahweh gives wisdom. Out of his mouth comes knowledge and understanding.' },
  { ref: 'Psalms 111:10', text: 'The fear of Yahweh is the beginning of wisdom. All those who do his work have a good understanding. His praise endures forever!' },
  { ref: 'Proverbs 16:16', text: 'How much better it is to get wisdom than gold! Yes, to get understanding is to be chosen rather than silver.' },
  { ref: 'Proverbs 9:10', text: 'The fear of Yahweh is the beginning of wisdom. The knowledge of the Holy One is understanding.' },
  { ref: 'Psalms 90:12', text: 'So teach us to count our days, that we may gain a heart of wisdom.' },
  { ref: 'Proverbs 19:20', text: 'Listen to counsel and receive instruction, that you may be wise in your latter end.' },
  { ref: 'Proverbs 3:7', text: 'Don\'t be wise in your own eyes. Fear Yahweh, and depart from evil.' },

  // ── prayer ──
  { ref: 'Romans 8:26', text: 'In the same way, the Spirit also helps our weaknesses, for we don\'t know how to pray as we ought. But the Spirit himself makes intercession for us with groanings which can\'t be uttered.' },
  { ref: 'Matthew 6:6', text: 'But you, when you pray, enter into your inner room, and having shut your door, pray to your Father who is in secret; and your Father who sees in secret will reward you openly.' },
  { ref: '1 Thessalonians 5:17', text: 'Pray without ceasing.' },
  { ref: 'Jeremiah 33:3', text: 'Call to me, and I will answer you, and will show you great things, and difficult, which you don\'t know.' },
  { ref: 'John 15:7', text: 'If you remain in me, and my words remain in you, you will ask whatever you desire, and it will be done for you.' },
  { ref: '1 John 5:14', text: 'This is the boldness which we have toward him, that if we ask anything according to his will, he listens to us.' },
  { ref: 'Psalms 145:18', text: 'Yahweh is near to all those who call on him, to all who call on him in truth.' },
  { ref: 'Luke 11:9', text: 'I tell you, keep asking, and it will be given you. Keep seeking, and you will find. Keep knocking, and it will be opened to you.' },
  { ref: 'Psalms 5:3', text: 'Yahweh, in the morning you will hear my voice. In the morning I will lay my requests before you, and will watch expectantly.' },

  // ── grace ──
  { ref: 'Romans 6:14', text: 'For sin will not have dominion over you, for you are not under law, but under grace.' },
  { ref: 'John 1:16', text: 'From his fullness we all received grace upon grace.' },
  { ref: '1 Corinthians 15:10', text: 'But by the grace of God I am what I am. His grace which was given to me was not futile, but I worked more than all of them; yet not I, but the grace of God which was with me.' },
  { ref: 'Titus 2:11', text: 'For the grace of God has appeared, bringing salvation to all men.' },
  { ref: '2 Corinthians 9:8', text: 'And God is able to make all grace abound to you, that you, always having all sufficiency in everything, may abound to every good work.' },
  { ref: 'John 1:14', text: 'The Word became flesh and lived among us. We saw his glory, such glory as of the only born Son of the Father, full of grace and truth.' },
  { ref: 'Romans 3:24', text: 'Being justified freely by his grace through the redemption that is in Christ Jesus.' },

  // ── courage and strength ──
  { ref: '1 Chronicles 28:20', text: 'David said to Solomon his son, "Be strong and courageous, and do it. Don\'t be afraid, nor be dismayed, for Yahweh God, even my God, is with you. He will not fail you nor forsake you."' },
  { ref: 'Mark 5:36', text: 'But Jesus, when he heard the message spoken, immediately said to the ruler of the synagogue, "Don\'t be afraid, only believe."' },
  { ref: 'Proverbs 28:1', text: 'The wicked flee when no one pursues; but the righteous are as bold as a lion.' },
  { ref: 'Isaiah 40:29', text: 'He gives power to the weak. He increases the strength of him who has no might.' },
  { ref: 'Psalms 18:2', text: 'Yahweh is my rock, my fortress, and my deliverer; my God, my rock, in whom I take refuge; my shield, and the horn of my salvation, my high tower.' },
  { ref: 'Psalms 18:32', text: 'The God who arms me with strength, and makes my way perfect.' },
  { ref: 'Exodus 14:14', text: 'Yahweh will fight for you, and you shall be still.' },

  // ── healing ──
  { ref: 'Jeremiah 17:14', text: 'Heal me, O Yahweh, and I will be healed. Save me, and I will be saved; for you are my praise.' },
  { ref: 'Isaiah 53:5', text: 'But he was pierced for our transgressions. He was crushed for our iniquities. The punishment that brought our peace was on him; and by his wounds we are healed.' },
  { ref: 'Jeremiah 30:17', text: '"For I will restore health to you, and I will heal you of your wounds," says Yahweh.' },
  { ref: 'Psalms 41:3', text: 'Yahweh will sustain him on his sickbed, and restore him from his bed of illness.' },
  { ref: 'Psalms 103:2', text: 'Praise Yahweh, my soul, and don\'t forget all his benefits.' },
  { ref: 'James 5:15', text: 'And the prayer of faith will heal him who is sick, and the Lord will raise him up. If he has committed sins, he will be forgiven.' },

  // ── protection ──
  { ref: '2 Thessalonians 3:3', text: 'But the Lord is faithful, who will establish you and guard you from the evil one.' },
  { ref: 'Psalms 32:7', text: 'You are my hiding place. You will preserve me from trouble. You will surround me with songs of deliverance.' },
  { ref: 'Psalms 34:7', text: 'Yahweh\'s angel encamps around those who fear him, and delivers them.' },
  { ref: 'Proverbs 18:10', text: 'Yahweh\'s name is a strong tower: the righteous run to it, and are safe.' },
  { ref: 'Psalms 138:7', text: 'Though I walk in the middle of trouble, you will revive me. You will stretch out your hand against the wrath of my enemies. Your right hand will save me.' },
  { ref: '2 Timothy 4:18', text: 'And the Lord will deliver me from every evil work, and will preserve me for his heavenly Kingdom. To him be the glory forever and ever. Amen.' },
  { ref: 'Hebrews 13:6', text: 'So that with good courage we say, "The Lord is my helper. I will not fear. What can man do to me?"' },
  { ref: 'Psalms 91:2', text: 'I will say of Yahweh, "He is my refuge and my fortress; my God, in whom I trust."' },

  // ── community and fellowship ──
  { ref: 'Galatians 6:2', text: 'Bear one another\'s burdens, and so fulfill the law of Christ.' },
  { ref: 'Matthew 18:20', text: 'For where two or three are gathered together in my name, there I am in the middle of them.' },
  { ref: '1 John 1:7', text: 'But if we walk in the light as he is in the light, we have fellowship with one another, and the blood of Jesus Christ, his Son, cleanses us from all sin.' },
  { ref: 'Psalms 133:1', text: 'See how good and how pleasant it is for brothers to dwell together in unity!' },
  { ref: '1 Peter 3:8', text: 'Finally, be all like-minded, compassionate, loving as brothers, tender hearted, courteous.' },
  { ref: 'Romans 12:16', text: 'Be of the same mind one toward another. Don\'t set your mind on high things, but associate with the humble. Don\'t be wise in your own conceits.' },

  // ── salvation ──
  { ref: 'Acts 16:31', text: 'They said, "Believe in the Lord Jesus Christ, and you will be saved, you and your household."' },
  { ref: 'Titus 3:5', text: 'Not by works of righteousness which we did ourselves, but according to his mercy, he saved us through the washing of regeneration and renewing by the Holy Spirit.' },
  { ref: 'John 3:36', text: 'One who believes in the Son has eternal life, but one who disobeys the Son won\'t see life, but the wrath of God remains on him.' },
  { ref: 'Psalms 62:1', text: 'My soul rests in God alone. My salvation is from him.' },
  { ref: 'Romans 10:13', text: 'For, "Whoever will call on the name of the Lord will be saved."' },

  // ── praise and worship ──
  { ref: 'Psalms 150:6', text: 'Let everything that has breath praise Yah! Praise Yah!' },
  { ref: 'Psalms 34:1', text: 'I will bless Yahweh at all times. His praise will always be in my mouth.' },
  { ref: 'Psalms 100:1', text: 'Shout for joy to Yahweh, all you lands!' },
  { ref: 'Psalms 100:2', text: 'Serve Yahweh with gladness. Come before his presence with singing.' },
  { ref: '1 Peter 2:9', text: 'But you are a chosen race, a royal priesthood, a holy nation, a people for God\'s own possession, that you may proclaim the excellence of him who called you out of darkness into his marvelous light.' },
  { ref: '1 Corinthians 15:57', text: 'But thanks be to God, who gives us the victory through our Lord Jesus Christ.' },
  { ref: 'Ephesians 5:19', text: 'Speaking to one another in psalms, hymns, and spiritual songs; singing and making melody in your heart to the Lord.' },
  { ref: 'Psalms 95:1', text: 'Oh come, let\'s sing to Yahweh. Let\'s shout aloud to the rock of our salvation!' },
  { ref: 'Psalms 145:3', text: 'Great is Yahweh, and greatly to be praised! His greatness is unsearchable.' },
  { ref: 'Psalms 96:1', text: 'Sing to Yahweh a new song! Sing to Yahweh, all the earth.' },
  { ref: 'Isaiah 25:1', text: 'Yahweh, you are my God. I will exalt you! I will praise your name, for you have done wonderful things, things planned long ago, in complete faithfulness and truth.' },
  { ref: 'Psalms 139:14', text: 'I will give thanks to you, for I am fearfully and wonderfully made. Your works are wonderful. My soul knows that very well.' },

  // ── God's promises and character ──
  { ref: '2 Peter 1:4', text: 'By which he has granted to us his precious and exceedingly great promises; that through these you may become partakers of the divine nature, having escaped from the corruption that is in the world by lust.' },
  { ref: '2 Corinthians 1:20', text: 'For however many are the promises of God, in him is the "Yes." Therefore also through him is the "Amen," to the glory of God through us.' },
  { ref: 'Psalms 84:11', text: 'For Yahweh God is a sun and a shield. Yahweh will give grace and glory. He withholds no good thing from those who walk blamelessly.' },
  { ref: 'Psalms 103:8', text: 'Yahweh is merciful and gracious, slow to anger, and abundant in loving kindness.' },
  { ref: 'Psalms 145:9', text: 'Yahweh is good to all. His tender mercies are over all his works.' },
  { ref: 'Psalms 145:17', text: 'Yahweh is righteous in all his ways, and gracious in all his works.' },
  { ref: 'Psalms 36:5', text: 'Your loving kindness, Yahweh, is in the heavens. Your faithfulness reaches to the skies.' },
  { ref: 'Psalms 57:10', text: 'For your great loving kindness reaches to the heavens, and your truth to the skies.' },
  { ref: 'Psalms 86:15', text: 'But you, Lord, are a merciful and gracious God, slow to anger, and abundant in loving kindness and truth.' },

  // ── God's word ──
  { ref: 'Hebrews 4:12', text: 'For the word of God is living and active, and sharper than any two-edged sword, piercing even to the dividing of soul and spirit, of both joints and marrow, and is able to discern the thoughts and intentions of the heart.' },
  { ref: 'James 1:22', text: 'But be doers of the word, and not only hearers, deluding your own selves.' },
  { ref: 'Psalms 19:14', text: 'Let the words of my mouth and the meditation of my heart be acceptable in your sight, Yahweh, my rock, and my redeemer.' },
  { ref: 'Isaiah 40:8', text: 'The grass withers, the flower fades; but the word of our God stands forever.' },
  { ref: 'Psalms 33:4', text: 'For Yahweh\'s word is right. All his work is done in faithfulness.' },
  { ref: 'Psalms 119:11', text: 'I have hidden your word in my heart, that I might not sin against you.' },
  { ref: 'Psalms 12:6', text: 'Yahweh\'s words are flawless words, as silver refined in a clay furnace, purified seven times.' },

  // ── identity in Christ ──
  { ref: '1 Corinthians 6:19', text: 'Or don\'t you know that your body is a temple of the Holy Spirit who is in you, whom you have from God? You are not your own.' },
  { ref: 'John 14:15', text: 'If you love me, keep my commandments.' },
  { ref: 'John 17:3', text: 'This is eternal life, that they should know you, the only true God, and him whom you sent, Jesus Christ.' },
  { ref: 'Psalms 138:8', text: 'Yahweh will fulfill that which concerns me. Your loving kindness, Yahweh, endures forever. Don\'t forsake the works of your own hands.' },
  { ref: 'Philippians 3:14', text: 'I press on toward the goal for the prize of the high calling of God in Christ Jesus.' },
  { ref: 'Psalms 16:8', text: 'I have set Yahweh always before me. Because he is at my right hand, I shall not be moved.' },

  // ── miscellaneous popular verses ──
  { ref: 'Psalms 19:1', text: 'The heavens declare the glory of God. The expanse shows his handiwork.' },
  { ref: 'Genesis 1:1', text: 'In the beginning, God created the heavens and the earth.' },
  { ref: 'Revelation 3:20', text: 'Behold, I stand at the door and knock. If anyone hears my voice and opens the door, then I will come in to him and will dine with him, and he with me.' },
  { ref: 'Matthew 11:29', text: 'Take my yoke upon you and learn from me, for I am gentle and humble in heart; and you will find rest for your souls.' },
  { ref: 'Matthew 6:24', text: 'No one can serve two masters, for either he will hate the one and love the other, or else he will be devoted to one and despise the other. You can\'t serve both God and Mammon.' },
  { ref: 'Mark 8:36', text: 'For what does it profit a man to gain the whole world and forfeit his life?' },
  { ref: 'Mark 12:30', text: 'You shall love the Lord your God with all your heart, with all your soul, with all your mind, and with all your strength.' },
  { ref: '2 Corinthians 5:21', text: 'For him who knew no sin he made to be sin on our behalf, so that in him we might become the righteousness of God.' },
  { ref: 'Ephesians 6:12', text: 'For our wrestling is not against flesh and blood, but against the principalities, against the powers, against the world\'s rulers of the darkness of this age, and against the spiritual forces of wickedness in the heavenly places.' },
  { ref: 'James 2:14', text: 'What good is it, my brothers, if a man says he has faith, but has no works? Can that faith save him?' },
  { ref: 'Joshua 1:8', text: 'This book of the law shall not depart from your mouth, but you shall meditate on it day and night, that you may observe to do according to all that is written in it; for then you shall make your way prosperous, and then you shall have good success.' },
  { ref: 'Acts 2:38', text: 'Peter said to them, "Repent, and be baptized, every one of you, in the name of Jesus Christ for the forgiveness of sins, and you will receive the gift of the Holy Spirit."' },
  { ref: 'Acts 1:8', text: 'But you will receive power when the Holy Spirit has come upon you. You will be my witnesses in Jerusalem, in all Judea and Samaria, and to the uttermost parts of the earth.' },
  { ref: '1 Peter 5:10', text: 'But may the God of all grace, who called you to his eternal glory by Christ Jesus, after you have suffered a little while, perfect, establish, strengthen, and settle you.' },
  { ref: 'Romans 5:3', text: 'Not only this, but we also rejoice in our sufferings, knowing that suffering produces perseverance.' },
  { ref: 'Romans 5:4', text: 'And perseverance, proven character; and proven character, hope.' },
  { ref: 'Hebrews 12:2', text: 'Looking to Jesus, the author and perfecter of faith, who for the joy that was set before him endured the cross, despising its shame, and has sat down at the right hand of the throne of God.' },
  { ref: 'Psalms 62:6', text: 'He alone is my rock and my salvation, my fortress. I will not be shaken.' },
  { ref: 'Psalms 61:2', text: 'From the end of the earth, I will call to you when my heart is overwhelmed. Lead me to the rock that is higher than I.' },
  { ref: 'Psalms 63:3', text: 'Because your loving kindness is better than life, my lips shall praise you.' },
  { ref: 'Isaiah 30:15', text: 'For thus said the Lord Yahweh, the Holy One of Israel, "You will be saved in returning and rest. Your strength will be in quietness and in confidence."' },
  { ref: 'Philippians 2:13', text: 'For it is God who works in you both to will and to work for his good pleasure.' },
  { ref: '2 Corinthians 4:18', text: 'While we don\'t look at the things which are seen, but at the things which are not seen. For the things which are seen are temporal, but the things which are not seen are eternal.' },
  { ref: 'Isaiah 43:4', text: 'Since you have been precious and honored in my sight, and I have loved you, therefore I will give people in your place, and nations instead of your life.' },
  { ref: 'Psalms 90:17', text: 'Let the favor of the Lord our God be on us. Establish the work of our hands for us. Yes, establish the work of our hands.' },
  { ref: '1 Peter 3:15', text: 'But sanctify the Lord God in your hearts. Always be ready to give an answer to everyone who asks you a reason concerning the hope that is in you, with humility and fear.' },
  { ref: 'Psalms 37:23', text: 'A man\'s steps are established by Yahweh. He delights in his way.' },
  { ref: 'Proverbs 15:23', text: 'Joy comes to a man with the reply of his mouth. How good is a word at the right time!' },
  { ref: 'Psalms 94:19', text: 'In the multitude of my thoughts within me, your comforts delight my soul.' },
  { ref: 'Isaiah 54:17', text: '"No weapon that is formed against you will prevail; and you will condemn every tongue that rises against you in judgment. This is the heritage of Yahweh\'s servants, and their righteousness is of me," says Yahweh.' },
  { ref: 'Psalms 71:8', text: 'My mouth shall be filled with your praise, with your honor all day long.' },
  { ref: 'Psalms 59:16', text: 'But I will sing of your strength. Yes, I will sing aloud of your loving kindness in the morning. For you have been my high tower, a refuge in the day of my distress.' },
  { ref: 'Proverbs 14:29', text: 'He who is slow to anger has great understanding, but he who has a quick temper displays folly.' },
  { ref: 'Luke 6:35', text: 'But love your enemies, and do good, and lend, expecting nothing back; and your reward will be great, and you will be children of the Most High; for he is kind toward the unthankful and evil.' },
  { ref: 'Psalms 3:3', text: 'But you, Yahweh, are a shield around me, my glory, and the one who lifts up my head.' },
  { ref: '2 Chronicles 7:14', text: 'If my people who are called by my name will humble themselves, pray, seek my face, and turn from their wicked ways, then I will hear from heaven, will forgive their sin, and will heal their land.' },
  { ref: 'Matthew 5:44', text: 'But I tell you, love your enemies, bless those who curse you, do good to those who hate you, and pray for those who mistreat you and persecute you.' },
  { ref: '1 John 4:16', text: 'We know and have believed the love which God has for us. God is love, and he who remains in love remains in God, and God remains in him.' },
  { ref: 'Psalms 91:1', text: 'He who dwells in the secret place of the Most High will rest in the shadow of the Almighty.' }, // NOTE: BOOK_NAMES has no Psalms 91, but parseRef handles "Psalms"
  { ref: 'Psalms 46:10', text: 'Be still, and know that I am God. I will be exalted among the nations. I will be exalted in the earth.' },
  { ref: 'Psalms 121:1', text: 'I will lift up my eyes to the hills. Where does my help come from?' },
  { ref: 'Psalms 121:2', text: 'My help comes from Yahweh, who made heaven and earth.' },
  { ref: 'Psalms 100:5', text: 'For Yahweh is good. His loving kindness endures forever, his faithfulness to all generations.' },
  { ref: 'Psalms 37:39', text: 'But the salvation of the righteous is from Yahweh. He is their stronghold in the time of trouble.' },
  { ref: 'Psalms 73:28', text: 'But it is good for me to come close to God. I have made the Lord Yahweh my refuge, that I may tell of all your works.' },
  { ref: 'Colossians 1:11', text: 'Strengthened with all power, according to the might of his glory, for all endurance and perseverance with joy.' },
  { ref: 'Psalms 16:9', text: 'Therefore my heart is glad, and my tongue rejoices. My body shall also dwell in safety.' },
  { ref: 'Proverbs 11:2', text: 'When pride comes, then comes shame, but with humility comes wisdom.' },
  { ref: 'Proverbs 12:15', text: 'The way of a fool is right in his own eyes, but he who is wise listens to counsel.' },
  { ref: 'Psalms 4:7', text: 'You have put gladness in my heart, more than when their grain and their new wine are increased.' },
  { ref: 'Matthew 6:14', text: 'For if you forgive men their trespasses, your heavenly Father will also forgive you.' },
  { ref: 'Isaiah 55:12', text: 'For you shall go out with joy, and be led out with peace. The mountains and the hills will break out before you into singing, and all the trees of the field will clap their hands.' },
  { ref: 'Psalms 34:14', text: 'Depart from evil, and do good. Seek peace, and pursue it.' },
  { ref: 'Luke 23:34', text: 'Jesus said, "Father, forgive them, for they don\'t know what they are doing."' },
  { ref: 'Proverbs 15:18', text: 'A wrathful man stirs up contention, but one who is slow to anger appeases strife.' },
  { ref: 'Psalms 27:6', text: 'Now my head will be lifted up above my enemies around me. I will offer sacrifices of joy in his tent. I will sing, yes, I will sing praises to Yahweh.' },
  { ref: 'Psalms 5:11', text: 'But let all those who take refuge in you rejoice. Let them always shout for joy, because you defend them. Let those also who love your name be joyful in you.' },
  { ref: 'Luke 15:7', text: 'I tell you that even so there will be more joy in heaven over one sinner who repents, than over ninety-nine righteous people who need no repentance.' },
  { ref: 'Psalms 85:8', text: 'I will hear what God, Yahweh, will speak, for he will speak peace to his people, his saints.' },
  { ref: 'Matthew 24:13', text: 'But he who endures to the end will be saved.' },
  { ref: 'Psalms 31:14', text: 'But I trust in you, Yahweh. I said, "You are my God."' },
  { ref: 'Psalms 17:8', text: 'Keep me as the apple of your eye. Hide me under the shadow of your wings.' },
  { ref: 'Romans 13:8', text: 'Owe no one anything, except to love one another; for he who loves his neighbor has fulfilled the law.' },
  { ref: 'Proverbs 18:15', text: 'The heart of the discerning gets knowledge. The ear of the wise seeks knowledge.' },
  { ref: 'Romans 11:33', text: 'Oh the depth of the riches both of the wisdom and the knowledge of God! How unsearchable are his judgments, and his ways past tracing out!' },
  { ref: 'Ephesians 6:18', text: 'With all prayer and requests, praying at all times in the Spirit, and being watchful to that end in all perseverance and requests for all the saints.' },
  { ref: '2 Peter 3:18', text: 'But grow in the grace and knowledge of our Lord and Savior Jesus Christ. To him be the glory both now and forever. Amen.' },
  { ref: 'Psalms 103:11', text: 'For as the heavens are high above the earth, so great is his loving kindness toward those who fear him.' },
  { ref: 'Psalms 117:2', text: 'For his loving kindness is great toward us. Yahweh\'s faithfulness endures forever. Praise Yah!' },
  { ref: '1 John 4:10', text: 'In this is love, not that we loved God, but that he loved us, and sent his Son as the atoning sacrifice for our sins.' },
  { ref: 'Romans 8:38', text: 'For I am persuaded that neither death, nor life, nor angels, nor principalities, nor things present, nor things to come, nor powers.' },
  { ref: 'Ecclesiastes 9:7', text: 'Go your way — eat your bread with joy, and drink your wine with a merry heart; for God has already accepted your works.' },
  { ref: 'Psalms 50:23', text: 'Whoever offers the sacrifice of thanksgiving glorifies me, and prepares his way so that I will show God\'s salvation to him.' },
  { ref: 'James 3:17', text: 'But the wisdom that is from above is first pure, then peaceful, gentle, reasonable, full of mercy and good fruits, without partiality, and without hypocrisy.' },
  { ref: 'Psalms 71:23', text: 'My lips shall shout for joy! My soul, which you have redeemed, sings praises to you!' },
  { ref: 'Psalms 148:5', text: 'Let them praise Yahweh\'s name, for he commanded, and they were created.' },
  { ref: 'Psalms 109:30', text: 'I will give great thanks to Yahweh with my mouth. Yes, I will praise him among the multitude.' },

  { ref: 'Psalms 23:3', text: 'He restores my soul. He guides me in the paths of righteousness for his name\'s sake.' },
  { ref: 'Matthew 5:14', text: 'You are the light of the world. A city located on a hill can\'t be hidden.' },
  { ref: 'Isaiah 64:8', text: 'But now, Yahweh, you are our Father. We are the clay and you our potter. We all are the work of your hand.' },
  { ref: 'Psalms 46:5', text: 'God is within her. She shall not be moved. God will help her at dawn.' },
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

// KEEP THE BINDING, EMPTY THE LIST. app/*.jsx are classic scripts sharing one global scope, so deleting
// `RELAYS` is a ReferenceError at every reader and blanks the whole console/app. Readers (rule 2, grepped
// 2026-09-01): app/identity-extras.jsx:520 (`window.TrinityData.RELAYS || []`), app/screens-chat.jsx:105
// and :322, app/identity.jsx:1609 — all four are display-only fallbacks for when window.Fellowship is
// absent, and all four render correctly with an empty list. The sample rows used to name three generic
// public Nostr relays: TrinityOne relays are a closed network (reference/DOMAIN.md), so the product must
// not name a relay that is not one.
const RELAYS = [];

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
