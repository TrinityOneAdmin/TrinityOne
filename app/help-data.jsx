// help-data.jsx — TrinityOne Help content (source: help-content.md), structured for layout.
// window.HelpData. Block types: p | list | steps | do | dont | rule | note | callout
window.HelpData = {
  intro: 'Short, friendly guides for getting set up and keeping your account safe. Take your time — and ask anyone at church if you’d like a hand.',
  articles: [
    {
      id: 'welcome',
      illo: 'shield',
      title: 'How TrinityOne keeps you safe & private',
      summary: 'TrinityOne is different from most apps — in a good way, and for a reason.',
      minutes: 4,
      blocks: [
        { type: 'list', items: [
          { lead: 'No account, no password, no email.', text: 'There’s nothing to sign up for and nothing to forget.' },
          { lead: 'Your phone holds a private “key” that is you.', text: 'It’s made for you automatically and stays on your phone. It’s how your church knows it’s really you.' },
          { lead: 'Use your name so your church recognises you.', text: 'No phone number or email — just a friendly name your church sees. You can keep it private if you’d rather.' },
          { lead: 'No company in the middle.', text: 'Not even we can read into your account or reset it for you.' },
        ] },
        { type: 'callout', tone: 'gold', text: 'Wonderful for privacy — but it means one thing is now yours to do: a short backup. The next guide is the most important one. Please read it.' },
        // WHY ANY OF THIS MATTERS. Asked for by the owner, 2026-08-03. A volunteer told only "we take privacy
        // seriously" has no way to judge which of our warnings to act on — so they treat the 12 words, the
        // unlock code and the backup file as equally optional admin. The concrete reason is the one thing that
        // makes the difference, and it has to be said NATION-NEUTRALLY (this product is not built for one
        // country's threat model) and WITHOUT OVERCLAIMING — a congregation that believes it is invisible when
        // it is not is worse off than one that knows exactly what is exposed.
        { type: 'p', text: 'Why do we make a fuss about all this? Most church apps ask for your email, keep your congregation’s list on a company’s servers, and expect you to trust that company for ever. For a lot of churches that is merely a bit sad. For some, it is dangerous.' },
        { type: 'p', text: 'In many places today, belonging to a church is not a private matter you can simply keep to yourself. A list of members is a list of people who can be visited. A record of who messages whom is a map of a congregation — who leads it, who is new, whose home it meets in. That information has cost people their jobs, their families and their safety. It does not have to be leaked deliberately: a company can be compelled to hand it over, a laptop can be taken, a phone can be examined at a border.' },
        { type: 'p', text: 'So TrinityOne is built so that your church holds its own information, and there is no company in the middle who could be asked for it. That is the whole reason it works the way it does — and the reason the small jobs we ask of you actually matter.' },
        { type: 'list', items: [
          { lead: 'Your 12 words, on paper.', text: 'Because there is no company holding a copy, there is nobody to ask for a reset. That is what keeps your account out of anyone else’s hands — and it is why losing the words means losing the account.' },
          { lead: 'A proper password on any backup file.', text: 'A backup file can be copied. If it is ever taken, whoever has it has as long as they like to guess at it — so a short code is not enough there, even though it is fine for locking your phone.' },
          { lead: 'Marking children correctly.', text: 'The rules that stop an adult messaging a child are only as good as the list of who is a child. Keeping it right is a safeguarding job, not a technical one.' },
        ] },
        { type: 'p', text: 'And the honest part: no app can make you invisible. Someone examining your phone can still tell you use TrinityOne and which congregation it follows. Whoever runs your church’s server can see who is a member, and that two people messaged each other, even though they cannot read what was said. If where you live makes that dangerous, talk to your leaders about running your own server — and read “How it works” below, which sets out plainly what is protected and what is not.' },
        { type: 'callout', tone: 'clay', text: 'None of this is meant to frighten you. Most of it is one evening’s work, once — write down 12 words, pick a decent password for a backup, and you are done.' },
        { type: 'tech', text: 'Your “key” is a standard cryptographic keypair (secp256k1 — the curve Nostr and Bitcoin use). The public half is your identity (your npub); the private half signs everything you post, so it can’t be forged. There’s no server-side account — “you” is simply that keypair on your device, which is why no one, us included, can read into or reset it.' },
      ],
    },
    {
      id: 'words',
      illo: 'paper',
      title: 'Your 12 words',
      summary: 'The single most important thing. Think of them as the only key to a safe.',
      minutes: 3,
      star: true,
      blocks: [
        { type: 'p', text: 'When you set up, TrinityOne shows you 12 little words — your “recovery phrase”.' },
        { type: 'callout', tone: 'clay', text: 'As long as you have these 12 words, you can always get back into your account — even on a new phone. If you lose your phone and don’t have them written down, no one can get the account back for you. There’s no “forgot password”, because there’s no password and no company holding a copy.' },
        { type: 'steps', label: 'What to do — once', items: [
          'When the app shows your 12 words, write them on paper, in order, by hand.',
          'Keep the paper somewhere safe at home — with important documents, or a safe.',
          'Optional: write a second copy and keep it in a different safe place.',
          'Tick “I’ve saved it” in the app.',
        ] },
        { type: 'dont', items: [
          'Don’t take a photo or screenshot of them.',
          'Don’t type them into a text, email, or any website.',
          'Don’t tell anyone the words — not even someone claiming to be from the church or support.',
        ] },
        { type: 'rule', text: 'The 12 words live on paper, not on a screen — and only you have them.' },
        { type: 'tech', text: 'The 12 words are a standard BIP-39 mnemonic. They deterministically derive your private key (NIP-06), so the same words rebuild the exact same identity on any device or compatible app — there’s nothing on a server to “recover”.' },
      ],
    },
    {
      id: 'faq',
      illo: 'qr',
      title: 'Questions people actually ask',
      summary: 'The handful of things that catch people out — answered plainly, including the ones with an awkward answer.',
      minutes: 4,
      star: true,
      blocks: [
        // 2026-08-07, owner: the NIV answer moved here off the marketing page, and the rest were gathered from
        // the places people genuinely get stuck. Every answer below is checked against what the code actually
        // does — the value of a FAQ is that it is the one place allowed to give the awkward answer.
        { type: 'p', text: 'If something here does not match what you are seeing, ask a steward — do not assume you have broken it.' },

        { type: 'list', items: [
          { lead: 'Why isn’t the NIV (or ESV, or NLT) here?', text: 'Because they are not free to give away. Those translations are owned by publishers who charge for the right to include them in an app, per person, every year — and we would have to pass that on to your church. TrinityOne is free and stays free, so it ships the translations that are free to share: the WEB, the KJV, the ASV and over a thousand more, in many languages. If your church reads the NIV on a Sunday, bring your own Bible and use TrinityOne for everything around it. We would rather say this plainly than quietly charge you for it.' },

          { lead: 'I’ve got the app, but I can’t find my church.', text: 'There is no public list of churches to search — that is deliberate, because a searchable directory of congregations is exactly the thing some churches cannot afford to have. You join with the link, QR code or joining code your church shares. If you do not have one, ask whoever invited you, or anyone already using it at your church.' },

          { lead: 'It says “waiting for approval”. How long?', text: 'A steward usually lets people in within a day. Leave the app open and you will see it happen. If you close it, nothing is lost — but the app cannot notify you yet, so check back rather than waiting for a buzz.' },

          { lead: 'Can my church leaders read my private messages?', text: 'No — one-to-one messages are encrypted, so the server holds only scrambled text. But it does see THAT you and another person messaged, and when. Church group rooms are different: unless your church turned on encryption for a room, the server can read what is written there. The app says so at the top of every room, and it is worth believing it.' },

          { lead: 'I lost my 12 words and my phone. Can a steward fix it?', text: 'Partly, and it is important to know which part. A steward can put you back in your place — your name, your church, your groups — by moving your seat onto a new account. What cannot come back is anything that was locked to the old account: your old private messages, and any care records sealed to you. Those went with the words. This is the reason we make a fuss about writing them down.' },

          { lead: 'Why can’t I message this person?', text: 'If either of you is a young person, the church decides who may message whom: a child can message their own parent, their leaders, and adults the church has cleared for youth work — and nobody else. It works both ways, so an adult who is not cleared cannot start a conversation with a child either. It is enforced by the server, not just hidden in the app, so it holds even on a modified phone.' },

          { lead: 'Do I need to be online?', text: 'Not for the Bible — it is on your phone and works with no signal at all, including on a plane or in a basement. Anything involving other people (messages, rotas, care) needs a connection, and anything you write while offline is kept and sent when you are back.' },

          { lead: 'What is a “relay”, and do I need one?', text: 'The small server that carries your church’s messages. As a member you never touch it — your church is on one already. Churches can run their own if they want everything on hardware they control, and that is the only reason the word appears anywhere.' },

          { lead: 'Someone sent me the app as a file. Should I install it?', text: 'No — not even from someone you trust. Download it yourself from the TrinityOne site or your own church’s address. A changed copy looks exactly the same as a real one, and your phone cannot tell the difference the first time you install it. The person who sent it to you may not know theirs was tampered with.' },
        ] },

        { type: 'callout', tone: 'sage', text: 'Nothing here is a trick question. If an answer above worries you, that is a good reason to talk to your church rather than to stop using it — most of these have a simple next step.' },
      ],
    },
    {
      id: 'name',
      illo: 'face',
      title: 'Setting up your name & picture',
      summary: 'Be recognised in chat without giving any personal details.',
      minutes: 2,
      blocks: [
        { type: 'list', items: [
          { lead: 'Name', text: 'Tap your circle at the top, choose Display name, and type a friendly name — e.g. “Maria from Tuesday group”. Leave it blank to keep it private.' },
          { lead: 'Picture', text: 'Pick a symbol or your initial on a colour you choose. If your church turns on member photos, adults can also set a real photo — children always keep a symbol or initial, for safety. A steward can reset a photo that isn’t suitable.' },
        ] },
        { type: 'note', text: 'You can change these any time. They’re the only things others see — never your phone number, email, or real name.' },
        { type: 'callout', tone: 'sage', text: 'Some churches ask everyone to use a real first and last name so people recognise each other. If yours does, you’ll see a gentle nudge to add your surname — it stays within your church and shares no other details.' },
      ],
    },
    {
      id: 'reading',
      illo: 'book',
      title: 'Reading the Bible',
      summary: 'A whole Bible in your pocket — and it works with no signal.',
      minutes: 2,
      blocks: [
        { type: 'p', text: 'TrinityOne is a complete Bible you can read anywhere — on the bus, in the garden, in church — even with no internet at all. The first time you open it, a clear modern translation (the Berean Standard Bible) sets itself up for you. Nothing to buy, nothing to sign up for.' },
        { type: 'list', items: [
          { lead: 'Turn to any passage.', text: 'Tap the book name at the top to jump to a book and chapter.' },
          { lead: 'Make it comfy.', text: 'In the reader’s settings you can make the words bigger, and switch on tappable Strong’s word helps.' },
          { lead: 'Keep what speaks to you.', text: 'Highlight a verse, add a note, or bookmark it — these stay private on your phone.' },
        ] },
        { type: 'steps', label: 'Add another translation', items: [
          'In Read, tap the translation name at the very top (e.g. “BSB”).',
          'Tap “Browse all translations” and search — there are over a thousand, in many languages.',
          'Tap one to download it. It saves to your phone, then works offline forever after.',
        ] },
        { type: 'note', text: 'Bibles download only when you choose one, to keep the app small. Once downloaded, they’re yours offline. To switch versions, just tap the name at the top and pick.' },
        { type: 'callout', tone: 'sage', text: 'Want to find a verse? Use Search to look across every translation you’ve installed — by word or by reference.' },
        { type: 'tech', text: 'Translations are stored locally (IndexedDB) and read with a bundled WebAssembly SQLite engine, so the reader is fully offline once downloaded. Modules use open formats (MySword .bbl.mybible and USFM / Open.Bible); the 1,000+ extra translations mirror eBible.org.' },
      ],
    },
    {
      id: 'plans',
      illo: 'book',
      title: 'Reading plans & devotionals',
      summary: 'Read through the Bible with a rhythm, and catch what your church shares.',
      minutes: 2,
      blocks: [
        { type: 'p', text: 'The Plans tab helps you read with a rhythm — and it’s where the devotionals and reading plans your church shares turn up.' },
        { type: 'list', items: [
          { lead: 'Follow a plan', text: 'Browse and tap a plan to start. Each day shows your next reading; tick it off as you go. Your progress is saved on your phone.' },
          { lead: 'Devotionals from your church', text: 'When your church shares a devotional or a plan, it appears here — sometimes a few at once, sometimes one a day as they’re released.' },
          { lead: 'Keep your streak', text: 'Open the app each day to build a quiet reading streak — a gentle nudge, never a guilt-trip.' },
        ] },
        { type: 'note', text: 'Nothing here needs a sign-up — what you follow and your progress stay on your phone.' },
      ],
    },
    {
      id: 'library',
      illo: 'book',
      title: 'The Library — extras, study tools & audio',
      summary: 'More translations, study helps, and the Bible read aloud.',
      minutes: 2,
      blocks: [
        { type: 'p', text: 'The Library is where you add to your shelf — more Bible translations, study tools, and audio Bibles you can listen to. Everything downloads only when you choose it, so the app stays small and works offline once it’s on your phone.' },
        { type: 'list', items: [
          { lead: 'Audio Bibles', text: 'Download a book and listen — handy for the commute, the kitchen, or resting your eyes. A little player keeps your place.' },
          { lead: 'Study tools', text: 'Add dictionaries and word helps (like Strong’s) to dig into the original words.' },
          { lead: 'Listen & Watch', text: 'If your church links a podcast or a video channel, their talks show up under Listen and Watch.' },
        ] },
        { type: 'callout', tone: 'sage', text: 'Downloads live on your phone and don’t need a signal once they’re there. Remove anything you’re not using to free up space — you can always get it again.' },
      ],
    },
    {
      id: 'community',
      illo: 'people',
      title: 'Your church & messaging',
      summary: 'Stay connected with your church family — simply and safely.',
      minutes: 3,
      blocks: [
        { type: 'p', text: 'The Community tab is where your church life lives: announcements, group chats, and private messages. It’s a quiet, friendly space — just your church, no strangers, no adverts.' },
        { type: 'steps', label: 'Follow your church', items: [
          'Tap your circle at the top → “Follow a church”.',
          'Point your camera at the church’s QR code, or paste the link they gave you.',
          'That’s it — you’ll see their groups and announcements.',
        ] },
        { type: 'note', text: 'Some churches approve new members first. If yours does, you’ll see “Request sent — waiting for approval” — you can look around, and you’ll be able to post once a steward lets you in.' },
        { type: 'list', items: [
          { lead: 'Groups & announcements', text: 'Join in the chat, or read what the church shares. A little dot on Community tells you when something new arrives.' },
          { lead: 'Private messages', text: 'Message anyone in your church one-to-one. These are private — only you and they can read them. To keep young people safe, private messages between a child and an adult are limited to the child’s own parent and cleared youth workers.' },
          { lead: 'Share what blesses you', text: 'Send a verse, a note, or a prayer into a group with a tap.' },
          { lead: 'Prayer requests', text: 'Mark any message as a prayer request (tap 🙏) — others can see it and lift it in prayer.' },
          { lead: 'Polls', text: 'A quick poll might pop up in a group (“which date for the picnic?”). Tap an option to vote and watch the results update.' },
        ] },
        { type: 'callout', tone: 'gold', text: 'It’s a church, so do use your name — it helps people recognise and welcome you. You can stay private if you’d rather (see “Setting up your name & picture”).' },
        { type: 'p', text: 'A gentle word about that “key” you may have read about:' },
        { type: 'list', items: [
          { lead: 'You don’t manage it day to day.', text: 'The key is just how the app quietly proves it’s really you posting — there’s no password to type and nothing to log into. You simply use the app.' },
          // HONESTY (audit 2026-07-24): this used to say the church "can't see your private things" full stop.
          // The CONTENT of a message is genuinely sealed, but a direct message carries an unencrypted "to" tag,
          // so the relay — which for a self-hosting church IS the church — can see WHO messaged whom and when.
          // For a congregation where the social graph is the danger, someone could act on the old sentence in a
          // way that gets them hurt. Say exactly what is and isn't hidden, and where to ask.
          { lead: 'What you write stays between you.', text: 'Your notes stay on your phone. What’s inside a direct message can only be read by you and the person you’re writing to — not your church, not us. The server that carries it can still see that you messaged someone, and when. If that matters where you live, ask your leaders how your church’s server is run.' },
          // WHERE THE ROOM DISCLOSURE LIVES NOW. Until 2026-08-13 every church room carried the sentence
          // "Church room · not end-to-end encrypted, so the relay can read messages here" across the top,
          // every time it was opened. The owner removed it: a permanent warning on a screen you open twenty
          // times a day is not read, and it made the room feel like somewhere to be careful rather than
          // somewhere to talk. The room still says "Not encrypted" on its face — but the fact needs somewhere
          // it is EXPLAINED, and the entry above says direct messages are private without saying that rooms
          // are not, which on its own reads as though everything is. So it is answered here, where a member
          // who wonders can find it.
          { lead: 'A church room is not the same as a message to one person.', text: 'When a room says “Not encrypted”, it means the server that carries your church’s messages can read what is written there. It is private from the outside world and from other churches, but not from whoever runs that server. Direct messages, and any room marked “End-to-end encrypted”, are different — those the server only ever holds scrambled. A good rule: treat a church room like talking in the hall after a service.' },
          { lead: 'The one thing to keep safe is your 12 words.', text: 'They’re the backup for everything — your name and your groups. Write them on paper once and you’re covered, even on a new phone.' },
        ] },
        { type: 'callout', tone: 'sage', text: 'Not sure about the 12 words? It really is just one small thing to do once — the guide “Your 12 words” walks you through it gently, and any steward at church will happily help.' },
        { type: 'tech', text: 'Chat runs on Nostr, an open protocol: posts are signed events a relay stores and serves — you can point the app at any relay, including your church’s own. Direct messages are end-to-end encrypted (NIP-44), so the relay holds only the ciphertext of what you wrote — it does still hold WHO messaged whom and WHEN, which is not yet hidden (sealing that, NIP-17, is on the roadmap). Group membership, invite-only privacy and the safeguarding rules are enforced by the relay’s write-policy server-side, so a modified app can’t bypass them.' },
      ],
    },
    {
      id: 'serving',
      illo: 'bell',
      title: 'Serving & church events',
      summary: 'See when you’re on the rota, say if you can make events, and find the order of service.',
      minutes: 2,
      blocks: [
        { type: 'p', text: 'If you help serve at church — welcome team, worship, kids’ work — TrinityOne keeps it simple. The Serving area shows where you’re needed and lets you reply in a tap.' },
        { type: 'list', items: [
          { lead: '“You’re serving” card', text: 'When you’re on the rota, a card shows your next slot — the team, your role, the date and time. Add it to your calendar with one tap.' },
          { lead: '“Can you serve?” requests', text: 'If your church asks you to cover a slot, you’ll get a gentle request — tap Yes, Can’t this time, or ask a teammate to swap.' },
          { lead: 'Swap or step back', text: 'On a slot you’re already on, tap to ask a specific teammate to swap, or “I’m away — take me off”. Your leader is told gently, so nothing is left uncovered.' },
          { lead: 'Mark when you’re away', text: 'Going on holiday or away for a few Sundays? Mark those dates away and you won’t be put on the rota for them — no need to decline each one.' },
          { lead: 'Order of service', text: 'If there’s a run sheet for the service, an “Order of service” button on your serving card shows what’s happening, in order, and who’s leading each part (with song details for worship teams).' },
        ] },
        { type: 'p', text: 'And for everything that’s on:' },
        { type: 'list', items: [
          { lead: 'Events & socials', text: 'See what’s coming up — workdays, prayer evenings, socials. Tap an event for full details.' },
          { lead: 'Let them know you’re coming', text: 'Tap Going / Maybe / Can’t so your church can plan.' },
        ] },
        { type: 'note', text: 'You only ever see serving and events for the church you follow — nothing from anywhere else.' },
      ],
    },
    {
      id: 'care',
      illo: 'heart',
      title: 'Practical care & meal trains',
      summary: 'When someone needs a hand, the church can rally round — meals, lifts, errands, visits.',
      minutes: 2,
      blocks: [
        { type: 'p', text: 'When a family has a new baby, someone’s unwell, or a person is grieving, the church can gather round with real, practical help. If your church turns this on, you’ll see open “needs” you can sign up for — a cooked meal on Tuesday, a lift to an appointment, a bit of shopping, a friendly visit. It’s the kind of showing-up a phone message can’t do on its own.' },
        { type: 'list', items: [
          { lead: 'See what’s needed', text: 'Open needs appear in your Today screen and under the Care tab — each shows the type of help, who it’s for, and which days still need someone.' },
          { lead: 'Pick a day to help', text: 'Tap a day and tap “I’ll help”. It shows as covered so two people don’t turn up for the same slot. Changed your plans? Tap again to step back — no fuss.' },
          { lead: 'Say what you’re bringing', text: 'For meals, you can jot a quick note (“lasagne + salad”) so the family gets some variety and helpers don’t all bring the same thing.' },
        ] },
        { type: 'callout', tone: 'sage', text: 'If the help is for you, the need is yours to steer. You’ll see “This is for you”, and on any day you’re already sorted you can tap “I’m sorted” — that day comes off the list, so no one cooks a meal you don’t need.' },
        { type: 'note', text: 'Some churches keep this to a small care team rather than the whole church — either way, it’s only ever your own church, and only for as long as the help is needed.' },
      ],
    },
    {
      id: 'directory',
      illo: 'people',
      title: 'The church directory',
      summary: 'Find someone in your church and reach them — without sharing phone numbers.',
      minutes: 2,
      blocks: [
        { type: 'p', text: 'The directory is your church’s private “People” list. It’s how you find a face and a name when you want to reach someone — without anyone handing out phone numbers or email addresses.' },
        { type: 'list', items: [
          { lead: 'Find a person', text: 'In Community, open People and search by name. Tap someone to start a private, one-to-one message.' },
          { lead: 'It’s only your church', text: 'The directory shows the people in your church and no one else — no strangers, no wider internet.' },
          { lead: 'You choose what shows', text: 'Others see the name and picture you set (see “Setting up your name & picture”) — never a phone number, email, or real name you haven’t chosen to share.' },
        ] },
        { type: 'note', text: 'To keep young people safe, the same protections apply here: a child can only be messaged by their own parent and cleared youth workers (see “Children & keeping young people safe”).' },
      ],
    },
    {
      id: 'family-safety',
      illo: 'people',
      title: 'Children & keeping young people safe',
      summary: 'How your church protects under-18s — and how a parent sets up a child’s account.',
      minutes: 3,
      blocks: [
        { type: 'p', text: 'TrinityOne helps your church look after children online. Your church — not a tick-box — decides who is a child and which adults are cleared to work with young people, so the protection matches the care already taken in person. It works alongside your church’s safeguarding (background checks, policy), never instead of it.' },
        { type: 'list', items: [
          { lead: 'Children see only child-safe groups', text: 'A young person’s app shows just the groups your church has marked safe for them. Adult spaces never appear.' },
          { lead: 'Private messages are protected', text: 'A child can only be privately messaged by their own parent and by adults the church has cleared for youth work. Any other adult simply can’t.' },
          { lead: 'Your leaders are always reachable', text: 'A young person can always message the church itself if they need help.' },
        ] },
        { type: 'p', text: 'A parent can set up and look after a child’s account from their own phone:' },
        { type: 'steps', label: 'Set up your child’s account', items: [
          'Tap your circle at the top → “Children’s accounts” → “Add a child”.',
          'Enter their name. The app makes a new account and shows you its 12 recovery words — write them down and keep them safe.',
          'On your child’s phone, sign them in with the code you are shown: in the app, “I’ve used it before” → “Someone set this up for me”, then point their camera at it. If the app is not installed yet, their phone’s normal camera opens it in the browser instead.',
          'A steward confirms the link — then your child is protected by the rules above.',
        ] },
        { type: 'callout', tone: 'sage', text: 'You hold your child’s 12 recovery words, so the account is yours to look after. A steward confirms every parent–child link, so no one can attach themselves to a child who isn’t theirs.' },
        { type: 'note', text: 'Not every child needs a parent account. A young person who comes to youth club can join on their own and your church will still mark and protect them — the parent link just adds a guarantee that you and your child can always reach each other.' },
        // MARKETING-AUDIT-2026-08-05: from verify-a-child.html, now deleted. That page had been serving three
        // unresolved "📸 Screenshot placeholder — replace this box with a real screenshot" boxes to the public
        // since 2026-06-25; the steps are the part that mattered and they read fine without pictures.
        { type: 'p', text: 'For stewards — how you mark a young person. A child is only ever marked by a steward, or confirmed from a parent’s request. It is never self-declared, and never a “are you over 18?” tick-box:' },
        { type: 'steps', label: 'Mark a young person as a child', items: [
          'Open the Steward console → Members, and find them in the list.',
          'Tap “Child”. A badge appears beside their name — that is the whole job.',
          'The two protections above start immediately, and are enforced by the relay rather than by their phone, so they cannot be switched off by tampering with a device.',
        ] },
        { type: 'note', text: 'This supports your church’s safeguarding — it doesn’t replace background checks, training, supervision or policy. If you’re ever concerned, speak to your church’s safeguarding lead.' },
        { type: 'tech', text: 'This is enforced at the relay, not just hidden in the app: the minor and approved-adult lists are owner-only, and the write-policy blocks child↔adult direct messages and child posts to adult groups server-side, so a tampered or third-party client can’t get around it.' },
      ],
    },
    {
      id: 'notifications',
      illo: 'bell',
      title: 'Notifications — staying in the loop',
      summary: 'Get a gentle nudge when something needs you — and choose exactly what.',
      minutes: 2,
      blocks: [
        { type: 'p', text: 'TrinityOne can let you know when there’s something for you — a message, a church announcement, or a request to serve — even when the app is closed. You’re always in control of what comes through.' },
        { type: 'steps', label: 'Turn them on or off', items: [
          'Tap your circle at the top → Settings → Notifications.',
          'Turn “Allow notifications” on (your phone may ask permission — tap Allow).',
          'Switch on only the things you’d like to hear about.',
        ] },
        { type: 'list', items: [
          { lead: 'Direct messages', text: 'When someone messages you directly. The alert never shows the message itself — just that one arrived.' },
          { lead: 'Church announcements', text: 'When your church posts in its announcements channel.' },
          { lead: 'Serving requests', text: 'When your church asks if you can serve.' },
          { lead: 'Serving reminders', text: 'A gentle reminder the evening before you’re due to serve.' },
        ] },
        { type: 'callout', tone: 'sage', text: 'On an iPhone or iPad, alerts work once TrinityOne is added to your Home Screen: tap the Share button → “Add to Home Screen”, then open it from the new icon and turn notifications on. The Notifications screen shows these steps for your device.' },
        { type: 'note', text: 'Changed your mind? Come back any time and switch things off. If your phone has blocked notifications, the app will show you a short note on how to turn them back on.' },
      ],
    },
    {
      id: 'restore',
      illo: 'phone',
      title: 'Getting a new phone',
      summary: 'This is exactly why you wrote down your 12 words.',
      minutes: 2,
      blocks: [
        { type: 'callout', tone: 'clay', text: 'Back up before you need to. The right day to save your 12 words is today — not the day your phone is lost, stolen, or broken. Open the Help screen and tap “Back up my 12 words”, write them on paper, and keep it somewhere safe. Those words are the one and only thing that brings your account — your name, your church and your groups — back.' },
        // CORRECTED TWICE. It first described a 12-word screen that did not exist; it was then rewritten to say
        // the backup FILE is the only way back — and that became wrong on 2026-07-26, when the member app got
        // the three routes below. Copy that denies a capability is as costly as copy that invents one: it sends
        // a member who has their words to "start fresh" as a stranger to their own church.
        { type: 'steps', label: 'Move to a new phone', items: [
          'Install TrinityOne on the new phone and open it.',
          'Choose “I’ve used it before”.',
          'Still have the old phone? Pick “I still have my old phone” and hold the two together — nothing to type. Otherwise type your 12 words.',
          'Compare the check code on both phones before you finish — all eight characters must match.',
          'You’re back — same account, same church, same groups.',
        ] },
        { type: 'note', text: 'Your notes, journal and highlights live only on the old phone. Restore your backup file afterwards to bring those across too — the 12 words bring back who you are, the file brings back what you wrote.' },
        { type: 'callout', tone: 'sage', text: 'Lost the words AND the old phone? Ask a steward. Choose “I’ve lost my 12 words”, show them the code on your screen, and your church can put you back in your place. Your old private messages stay locked — nobody can open those, which is the point of them being private.' },
        { type: 'tech', text: 'The backup file holds your BIP-39 identity plus your local study data, encrypted with your passphrase (AES-GCM, key stretched with memory-hard Argon2id; older files still open with the PBKDF2 they were made with). Restoring re-derives the same key, so you are the same person to your church. Note that your followed churches are stored on this device, so re-following is a manual step today.' },
      ],
    },
    {
      id: 'how-it-works',
      illo: 'qr',
      title: 'How it works (the technical bit)',
      summary: 'For the curious and the technical — the open standards under the warmth.',
      minutes: 3,
      blocks: [
        { type: 'p', text: 'You never need any of this to use TrinityOne. But if you like to know how a thing really works, here it is — and it’s all open standards, nothing proprietary.' },
        { type: 'list', items: [
          { lead: 'Your identity', text: 'A secp256k1 keypair on your device (the curve Nostr and Bitcoin use). Your public key is who you are; your private key signs what you post. No server-side account exists.' },
          { lead: 'The 12 words', text: 'A BIP-39 mnemonic that derives your key (NIP-06). The same words rebuild the exact same identity anywhere — nothing is stored on a server to “recover”.' },
          { lead: 'Messaging', text: 'Nostr, an open protocol. Posts are signed events held on relays (your church can run its own). Direct messages are end-to-end encrypted (NIP-44) — relays see only the ciphertext of the message, but still see who messaged whom and when.' },
          { lead: 'Privacy & safeguarding', text: 'Enforced by the relay’s write-policy, not just the app: membership, invite-only groups and child↔adult message rules are checked server-side, so a modified client can’t bypass them.' },
          { lead: 'The Bible', text: 'Stored locally (IndexedDB) and read with WebAssembly SQLite — fully offline. Modules are open formats (MySword, USFM / Open.Bible).' },
          { lead: 'Open source', text: 'The whole app is AGPL-3.0 and self-hostable — a church can run its own relay on a small box and hold all of its own data.' },
          // MARKETING-AUDIT-2026-08-05. Salvaged from how-trinityone-stays-up.html, which has been moved out
          // of the public site (it published the live relay hosts, their tailnet names, and the fact that the
          // primary and the fallback are the same machine). Its glossary was the genuinely good part and the
          // only part a reader outside the project needed — these are the three terms the rest of the site
          // uses without ever defining.
          { lead: 'Relay', text: 'The small server that stores and passes on your church’s messages. It holds events, not accounts — it is plumbing, and your church can run its own or use ours.' },
          { lead: 'Nostr', text: '“Notes and Other Stuff Transmitted by Relays” — the open protocol underneath. Every message is a small JSON document signed by your key, which is why no company has to be trusted to carry it.' },
          { lead: 'Module', text: 'A downloadable file — a Bible translation, a dictionary, a commentary, a devotional. It is cached on your device the first time you download it, and works offline after that.' },
        ] },
        { type: 'tech', text: 'Deeper still: the code is plain, bundler-free JSX you can read end to end, and the architecture and specs live in the project’s README and reference docs. Found a security issue? There’s a responsible-disclosure policy in SECURITY.md.' },
      ],
    },
    {
      id: 'scams',
      illo: 'noask',
      title: 'Staying safe from scams',
      summary: 'Because you’re in charge of your own key, a few simple rules keep you safe.',
      minutes: 2,
      blocks: [
        { type: 'list', items: [
          { lead: 'No one will ever need your 12 words.', text: 'The church won’t ask. We won’t ask. Support won’t ask. Anyone who asks is trying to take your account — and any money in it.' },
          { lead: 'We’ll never ask you to “verify” your words.', text: 'Any message asking you to confirm your words or key is not from us.' },
          { lead: 'If something feels off, pause.', text: 'Ask a trusted person at church before doing anything.' },
        ] },
        { type: 'rule', text: 'If in doubt: don’t share, don’t type them in. Close the app and ask someone you trust.' },
      ],
    },
    {
      id: 'console',
      illo: 'safe',
      title: 'For leaders — the steward console',
      summary: 'Run your church from a computer: members, groups, rotas, events and invites.',
      minutes: 3,
      blocks: [
        { type: 'p', text: 'If you lead or help run a church, the steward console is your behind-the-scenes desk — best opened on a computer. It’s where you welcome members, set up groups, build the serving rota, and post announcements. A first-time setup wizard walks you through naming the church and creating a few starter groups in about a minute.' },
        { type: 'list', items: [
          { lead: 'Invite people in', text: 'Share a joining code — a QR or a short code — for members to scan or type. If you prefer, approve each new member before they can post.' },
          { lead: 'Members', text: 'See who’s joined, and mark who’s a child and which adults are cleared for youth work, so the safeguarding rules apply automatically (see “Children & keeping young people safe”).' },
          { lead: 'Groups & announcements', text: 'Create chat rooms and announcement channels, set which are open or invite-only, and mark the ones that are safe for children.' },
          { lead: 'Rota', text: 'Build serving teams and schedules, send “Can you serve?” requests, and see who’s said yes, can’t, or is away.' },
          { lead: 'Events & calendar', text: 'Post events and socials and see who’s coming.' },
          { lead: 'Where your church lives (the relay)', text: 'Every church runs on a relay — the small server that carries its chat, members and announcements (the Bible reader needs none of it). New churches start on the shared TrinityOne relay with nothing to set up; when you’re ready, Settings → Relays can point your church at one you trust, or your own, without anyone losing anything.' },
        ] },
        { type: 'callout', tone: 'sage', text: 'Two extra desks can be switched on in Settings when you need them: Practical care (meal trains), and Church finances — a treasurer’s ledger (see the next guide).' },
        { type: 'note', text: 'Being a steward is delegated and revocable: a steward gets their own key and can be added or removed at any time, so leadership can change hands without anyone losing access to the church.' },
        // MARKETING-AUDIT-2026-08-05: from stewards-guide.html, now deleted (940 words, zero inbound links —
        // it had no href pointing at it from anywhere on the site). This distinction is the useful part, and
        // it is genuinely load-bearing: one of the two options cannot be undone.
        { type: 'p', text: 'There are two ways to share control of a church, and the difference is mostly about whether you can undo it:' },
        { type: 'list', items: [
          { lead: 'A delegated steward (recommended)', text: 'Nothing secret changes hands — you send an invite, they request, you approve, and they act under their own key. The church key is never copied to their device. Revoke them and they lose access instantly. Use this for volunteers and for a second leader you might change.' },
          { lead: 'A full handoff', text: 'You give someone the church’s 12-word recovery phrase, making them a co-owner with exactly your powers. This cannot be undone — once they have the phrase they have it for good, and the only way back is to move the church to a new key. Share it only with someone you would trust to be the church permanently.' },
        ] },
        // D4. stewards-guide.html listed "Manage who joins (approve / admit)" for a delegate with no caveat.
        // A delegate genuinely can admit — but the blocklist is owner-only at the relay
        // (scripts/gateway.mjs: `if (d.startsWith(BLOCKED_D)) return isLeader;  // OWNER-ONLY: banning is not
        // delegated to stewards`), so the half of "managing who joins" that keeps somebody OUT is not
        // delegated. A church that hands moderation to a volunteer needs to know that before it matters.
        { type: 'note', text: 'One limit worth knowing: a delegated steward can let people in, but only the owner can block or remove someone. If you are handing over the welcoming, keep the owner reachable for the times it has to go the other way.' },
        { type: 'tech', text: 'The console is the same app pointed at the church’s relay with owner/steward privileges. The relay’s write-policy is the real gatekeeper — membership, approvals, invite-only groups and the safeguarding rules are all enforced server-side, so they hold even against a modified client.' },
      ],
    },
    {
      id: 'giving-records',
      illo: 'paper',
      title: 'Church finances & statements (for treasurers)',
      summary: 'An optional, private ledger for a church’s bookkeeping — money in and out, fund tracking, and shareable quarter or year statements.',
      minutes: 2,
      blocks: [
        { type: 'p', text: 'A church treasurer can turn on a private Finance desk in the steward console — a simple ledger for the church’s own bookkeeping. You record money in and out in plain language, and it keeps the accounting balanced underneath.' },
        { type: 'list', items: [
          { lead: 'Record money in & out', text: 'Log offerings, standing orders and bills against clear categories — no accounting jargon, no debits and credits to learn.' },
          { lead: 'Fund tracking', text: 'Keep general, designated (say, a building fund) and restricted funds apart, so you always know what each pot holds.' },
          { lead: 'Import a bank statement', text: 'Upload a CSV your bank exports, tick the lines to bring in, and it files them for you — lines you’ve already imported are flagged so nothing double-counts.' },
          { lead: 'Share a statement', text: 'Produce a summary for a quarter or a year — totals by category and fund — then download it as a PDF, copy it into a message, or post it to members. You choose what goes in.' },
          { lead: 'Export for your accountant', text: 'Export the full ledger as a CSV whenever you need it.' },
        ] },
        { type: 'callout', tone: 'gold', text: 'The books are your church’s private bookkeeping, encrypted to a key of their own — the relay only ever holds unreadable ciphertext. The people who can open them are you and anyone you have given <b>Finance</b> to; nobody else, including whoever runs the relay. A statement you choose to share carries totals only, never member names, so it’s safe to hand out or post.' },
        { type: 'note', text: 'More is on the way, all free: a balance sheet and trustees’ report, budgets, and regional giving-relief packs (like UK Gift Aid). Giving straight from your own phone wallet is a separate idea we’re still building — nothing to set up for it yet.' },
      ],
    },
    {
      id: 'steward',
      illo: 'qr',
      title: 'Help from a steward',
      summary: 'If setting up yourself feels daunting, you don’t have to do it alone.',
      minutes: 2,
      blocks: [
        { type: 'p', text: 'A leader or steward at your church can create an identity for you and hand it over with a simple QR code (a square barcode). You just:' },
        { type: 'steps', label: 'With a steward’s help', items: [
          'Open TrinityOne → Restore / Scan invite.',
          'Point your camera at the QR code they show you.',
          'That’s it — you’re in, no typing.',
        ] },
        { type: 'callout', tone: 'sage', text: 'They can also help you write down your 12 words, so your account is safely backed up from day one. Ask anyone at church — they’ll be glad to help.' },
      ],
    },
  ],
  card: {
    title: 'Your TrinityOne account = your 12 words',
    lines: [
      { icon: 'paper', text: 'Write them on paper, in order. Keep the paper safe at home.' },
      { icon: 'noask', text: 'Never photograph, type online, or share them.' },
      { icon: 'phone', text: 'New phone? Use the 12 words to restore.' },
      { icon: 'shield', text: 'Anyone asking for your words is a scammer. The church will never ask.' },
    ],
  },
};
