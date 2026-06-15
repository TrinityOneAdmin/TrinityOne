// help-data.jsx — TrinityOne Help content (source: help-content.md), structured for layout.
// window.HelpData. Block types: p | list | steps | do | dont | rule | note | callout
window.HelpData = {
  intro: 'Short, friendly guides for keeping your account and giving safe. Take your time — and ask anyone at church if you’d like a hand.',
  articles: [
    {
      id: 'welcome',
      illo: 'shield',
      title: 'How TrinityOne keeps you safe & private',
      summary: 'TrinityOne is different from most apps — in a good way.',
      minutes: 2,
      blocks: [
        { type: 'list', items: [
          { lead: 'No account, no password, no email.', text: 'There’s nothing to sign up for and nothing to forget.' },
          { lead: 'Your phone holds a private “key” that is you.', text: 'It’s made for you automatically and stays on your phone. It’s how your church knows it’s really you.' },
          { lead: 'Use your name so your church recognises you.', text: 'No phone number or email — just a friendly name your church sees. You can keep it private if you’d rather.' },
          { lead: 'No company in the middle.', text: 'Not even we can read into your account or reset it for you.' },
        ] },
        { type: 'callout', tone: 'gold', text: 'Wonderful for privacy — but it means one thing is now yours to do: a short backup. The next guide is the most important one. Please read it.' },
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
          { lead: 'Picture', text: 'Choose a colour with your initial, or pick a small picture from the gallery. You can’t upload a photo — that keeps everyone private.' },
        ] },
        { type: 'note', text: 'You can change these any time. They’re the only things others see — never your phone number, email, or real name.' },
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
          'That’s it — you’ll see their groups, announcements, and giving.',
        ] },
        { type: 'list', items: [
          { lead: 'Groups & announcements', text: 'Join in the chat, or read what the church shares. A little dot on Community tells you when something new arrives.' },
          { lead: 'Private messages', text: 'Message anyone in your church one-to-one. These are private — only you and they can read them.' },
          { lead: 'Share what blesses you', text: 'Send a verse, a note, or a prayer into a group with a tap.' },
        ] },
        { type: 'callout', tone: 'gold', text: 'It’s a church, so do use your name — it helps people recognise and welcome you. You can stay private if you’d rather (see “Setting up your name & picture”).' },
        { type: 'p', text: 'A gentle word about that “key” you may have read about:' },
        { type: 'list', items: [
          { lead: 'You don’t manage it day to day.', text: 'The key is just how the app quietly proves it’s really you posting — there’s no password to type and nothing to log into. You simply use the app.' },
          { lead: 'Your church can’t see your private things.', text: 'Your notes stay on your phone, and your direct messages can only be read by you and the person you’re writing to.' },
          { lead: 'The one thing to keep safe is your 12 words.', text: 'They’re the backup for everything — your name, your groups, and your wallet. Write them on paper once and you’re covered, even on a new phone.' },
        ] },
        { type: 'callout', tone: 'sage', text: 'Not sure about the 12 words? It really is just one small thing to do once — the guide “Your 12 words” walks you through it gently, and any steward at church will happily help.' },
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
        { type: 'steps', label: 'Move to a new phone', items: [
          'Install TrinityOne on the new phone.',
          'On the welcome screen, choose “Restore” (or open your identity screen → Restore).',
          'Type your 12 words in order.',
          'You’re back — same name, same groups.',
        ] },
        { type: 'callout', tone: 'sage', text: 'If you don’t have the 12 words and the old phone is gone, that account can’t be recovered — you’d simply start fresh. So keep that paper safe.' },
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
      id: 'wallet',
      illo: 'wallet',
      title: 'Giving with the wallet',
      summary: 'Give to your church in a tap — here’s how it works, in plain terms.',
      minutes: 3,
      blocks: [
        { type: 'p', text: 'TrinityOne has a small wallet built in, just for giving to your church. Think of it like the change purse you’d drop in the collection — keep a little in it, and give whenever you like.' },
        { type: 'list', items: [
          { lead: 'What’s in it?', text: 'A small amount of digital money (its little units are called “sats”). The app always shows the cash value too — so you just pick an amount like “$5” and it handles the rest. You don’t need to learn anything new.' },
          { lead: 'It’s yours, held on your phone.', text: 'Not the church, not us — you hold it, protected by your same 12 words. Nobody can freeze it or take it.' },
          { lead: 'Keep only a little in it.', text: 'Like cash in a purse, not your savings.' },
        ] },
        { type: 'steps', label: 'Put money in your wallet', items: [
          'Tap your circle at the top → Your wallet.',
          'Tap “Add funds” and choose an amount.',
          'Follow the simple steps to pay in — the amount then shows in your wallet.',
        ] },
        { type: 'steps', label: 'Give to your church', items: [
          'Open Community → Giving.',
          'Pick what you’d like to give to, and an amount.',
          'Tap Give — it’s sent in a second, and you’ll see it confirmed.',
        ] },
        { type: 'steps', label: 'Take money back out — any time', items: [
          'Tap your circle → Your wallet → Withdraw.',
          'Send it to any other wallet you use. It’s your money — you’re never locked in.',
        ] },
        { type: 'list', items: [
          { lead: 'Give privately if you like.', text: 'Your church can see the gift, but not your name, if you choose.' },
          { lead: 'New phone? You’re covered.', text: 'Your 12 words restore your wallet too — so do keep them safe (see “Your 12 words”).' },
        ] },
        { type: 'callout', tone: 'gold', text: 'New to this? That’s completely normal — most people are. Ask a steward at church and they’ll happily walk you through your first gift.' },
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
