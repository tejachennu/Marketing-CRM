import 'explainer_content.dart';

/// What the voice says in each scene of the explainer videos: a spoken script, not the captions read aloud (owner,
/// 25 Nov 2026: "Indians use some English words in the middle ... cut cut ga undi, translation oka flow ledu"). Natural
/// Hyderabad Tenglish and Hinglish with everyday English words, and simple Indian English, flowing from scene to scene
/// like one person talking. Written with ChatGPT from the videos' content and checked here; no app name, no made-up
/// numbers. One entry per scene, in the order of explainer_content.dart. After changing any words, make the voice
/// again (mobile/design/voice/README.md).
const narration = <String, List<Tx>>{
  'grow': [
    Tx(
      'Your shop stays open on WhatsApp, 24 by 7. Customers message any time, and this app replies, books and sends bills for you.',
      'మీ shop WhatsApp లో 24 by 7 open గా ఉంటుంది. Customer ఎప్పుడు message చేసినా, ఈ app వెంటనే reply ఇచ్చి, booking, bill అన్నీ చూసుకుంటుంది.',
      'आपकी shop WhatsApp पर 24 by 7 खुली रहती है। Customer कभी भी message करे, यह app तुरंत reply, booking और bill सब संभाल लेता है।',
    ),
    Tx(
      'Now from ad to chat, A I reply, booking, bill and review, everything moves in one smooth flow inside this app.',
      'ఇప్పుడు ad నుంచి chat, A I reply, booking, bill, review వరకు—అన్నీ ఒకే app లో, ఒక flow లో పూర్తవుతాయి.',
      'अब ad से chat, A I reply, booking, bill, review तक—सब कुछ एक ही app में, एक smooth flow में होता है.',
    ),
    Tx(
      'Even at midnight, replies come in seconds. It uses your prices and timings, suggests a slot, and confirms the booking.',
      'అర్ధరాత్రి అయినా seconds లో reply వస్తుంది; మీ prices, timings చూసి సరైన time suggest చేసి, confirm వరకు తీసుకెళ్తుంది.',
      'आधी रात हो तब भी seconds में reply; आपकी prices और timings देखकर सही time suggest कर, confirm तक पहुँचा देता है.',
    ),
    Tx(
      'And reminders, bills and review requests go out automatically. Less phone follow-up, fewer missed visits for your team.',
      'అంతే కాదు, reminders, bills, review requests automatic గా వెళ్తాయి; phone follow-up తక్కువ అవుతుంది, miss అయ్యే visits కూడా తగ్గుతాయి.',
      'और हाँ, reminders, bills, review requests अपने आप जाते हैं; phone follow-up कम होता है, miss होने वाली visits घटती हैं.',
    ),
    Tx(
      'So more customers, less work. Start free for 14 days. No card needed. We are here to help.',
      'కాబట్టి customers పెరుగుతారు, పని తక్కువగా ఉంటుంది. 14 days free గా start చేయండి; card అవసరం లేదు—మేము మీతోనే ఉంటాం.',
      'तो customer बढ़ेंगे, काम कम लगेगा। 14 days free शुरू करें; card की ज़रूरत नहीं—हम साथ हैं.',
    ),
  ],
  'website': [
    Tx(
      'Set up your online store with products, prices, cart and payment. Use our address, or your own domain.',
      'మీ online store ready అవుతుంది—products, prices, cart, payment అన్నీ ఉండేలా. మా link పై లేదా మీ స్వంత domain పై.',
      'आपका online store तैयार—products, prices, cart, payment सब सेट। हमारे link पर या आपके अपने domain पर.',
    ),
    Tx(
      'Now for services, a booking site where customers see your team and pick a time themselves.',
      'ఇప్పుడు services ఉన్నవారికి, booking website కూడా—కస్టమర్లు services, team చూసి, వాళ్ళే time pick చేసి book చేసుకుంటారు.',
      'अब services वालों के लिए booking website—ग्राहक services और team देखकर अपना time चुनकर खुद book करते हैं.',
    ),
    Tx(
      'Put your link on Google, Instagram, WhatsApp and ads. They send people to your website for orders and bookings.',
      'లింక్‌ని Google, Instagram, WhatsApp, ads లో పెట్టండి; అప్పుడు traffic నేరుగా మీ website కి వచ్చి orders, bookings మొదలవుతాయి.',
      'Link को Google, Instagram, WhatsApp और ads में डालिए; फिर traffic सीधा website पर आकर orders, bookings शुरू करता है.',
    ),
    Tx(
      'Ready in minutes. It fills itself from your products and services. Our team can help with setup.',
      'సెటప్ minutes లో పూర్తవుతుంది; మీ products, services నుంచి auto fill అవుతుంది. అవసరమైతే మా team setup లో help చేస్తుంది.',
      'Setup minutes में हो जाता है; आपके products, services से auto fill होता है। ज़रूरत पर हमारी team setup में help करती है.',
    ),
    Tx(
      'Get found, get orders. Start free for 14 days, no card needed.',
      'ఇప్పుడు customers online లో మిమ్మల్ని easily కనుక్కుంటారు, orders వస్తాయి. 14 days free గా start చేయండి, card అవసరం లేదు.',
      'अब online आपको आसानी से मिलेंगे, orders आएँगे। 14 days free शुरू करें; card की ज़रूरत नहीं.',
    ),
  ],
  'instagram': [
    Tx(
      'Under your post, someone asks the price. The A I replies at once and sends full details by D M.',
      'మీ post కింద price అడిగారంటే, A I వెంటనే public గా reply చేసి, details ని D M లో neatly పంపిస్తుంది.',
      'आपकी post के नीचे price पूछा, तो A I तुरंत public reply देता है और details D M में भेज देता है.',
    ),
    Tx(
      'Now in D Ms, day and night, the A I replies in their language and guides them to order.',
      'ఇప్పుడు D M లో కూడా day-night support—A I కస్టమర్ భాషలో reply ఇచ్చి, order వరకు తీసుకెళ్తుంది.',
      'अब D M में भी day-night support—A I ग्राहक की language में reply देकर order तक ले जाता है.',
    ),
    Tx(
      'So bookings come from Instagram too. They pick a time in chat and it shows on your Front Desk.',
      'అంటే bookings కూడా Instagram నుంచే; chat లో time choose చేస్తే, అది వెంటనే మీ Front Desk లో కనిపిస్తుంది.',
      'मतलब Instagram से booking भी; chat में time चुनते ही वह तुरंत आपके Front Desk में दिखता है.',
    ),
    Tx(
      'This way, from a comment to a sale, Instagram and WhatsApp chats run in one app, with the same A I.',
      'ఇలా comment నుంచి sale వరకు—Instagram, WhatsApp chats ఒకే app లో, అదే A I తో కలిసి నడుస్తాయి.',
      'इस तरह comment से sale तक—Instagram और WhatsApp की chats एक ही app में, उसी A I के साथ चलती हैं.',
    ),
    Tx(
      'Sell on Instagram while you sleep. Connect Instagram, then switch on auto replies.',
      'ఇప్పుడు మీరు నిద్రపోయినా Instagram లో sales వస్తాయి. Instagram connect చేసి, auto replies ఆన్ చేయండి.',
      'अब आप सोएँ तब भी Instagram पर sales आती रहेंगी। Instagram connect करें, auto replies on करें.',
    ),
  ],
  'replies': [
    Tx(
      'At 11:42 pm, a customer asks. The A I replies in seconds, using your own prices.',
      'రాత్రి 11:42 కి కూడా కస్టమర్ అడిగితే, A I seconds లో reply ఇస్తుంది, మీ prices తోనే.',
      'रात 11:42 पर भी ग्राहक पूछे, A I seconds में जवाब देता है, आपकी prices के साथ.',
    ),
    Tx(
      'Now English, Telugu, Hindi or a mix—whatever they write in, it answers in that language.',
      'ఇప్పుడు English, Telugu, Hindi, mix ఏదైనా సరే—కస్టమర్ ఏ భాషలో రాస్తే, అదే భాషలో reply వస్తుంది.',
      'अब English, Telugu, Hindi, mix कुछ भी चले—ग्राहक जिस language में लिखे, उसी language में reply आता है।',
    ),
    Tx(
      'When it gets tricky, it hands the chat to your team with full context, so you can reply quickly.',
      'కాస్త tricky అయితే chat ని మీ team కి handover చేస్తుంది; పూర్తి chat తో మీరు వెంటనే reply ఇవ్వగలరు.',
      'थोड़ा tricky हो तो chat आपकी team को handover हो जाती है; पूरी chat दिखेगी, आप तुरंत reply कर पाएँगे.',
    ),
    Tx(
      'So add your services, prices and answers once. The A I uses them every time.',
      'అంటే మీరు ఒకసారి services, prices, answers add చేస్తే చాలు; ప్రతి సారి A I అవే details వాడుతుంది.',
      'मतलब services, prices, answers एक बार add कर दीजिए; हर बार A I वही details इस्तेमाल करेगा.',
    ),
    Tx(
      'Never miss a customer again. Your A I assistant works day and night, while you focus on the business.',
      'కాబట్టి ఇక కస్టమర్ miss కాదు. మీ A I assistant day-night పని చేసి, మీరు free గా focus చేయగలరు.',
      'अब कोई ग्राहक miss नहीं होगा। आपका A I assistant दिन-रात काम करे, और आप आराम से focus कर पाएँगे.',
    ),
  ],
  'inbox': [
    Tx(
      'Your whole team uses one WhatsApp number. All chats show in one place, on the app and the website.',
      'మీ team అంతా ఒకే WhatsApp number తో పని చేస్తారు; అన్ని chats ఈ app, website లో ఒకచోటే కనిపిస్తాయి.',
      'आपकी पूरी team एक ही WhatsApp number से काम करे; सारी chats app और website पर एक जगह दिखती हैं.',
    ),
    Tx(
      'Now assign each chat to the right staff. They see their chats only, so nothing gets missed.',
      'ఇప్పుడు ప్రతి chat ని సరైన staff కి assign చేస్తే, వాళ్లకు మాత్రమే కనిపిస్తుంది; ఏ chat కూడా మిస్ అవదు.',
      'अब हर chat सही staff को assign करें; उन्हें अपनी chats ही दिखेंगी, कोई chat miss नहीं होगी.',
    ),
    Tx(
      'Turn issues into tickets and track them until solved. Every step stays clear for the team.',
      'సమస్య వస్తే వెంటనే ticket create చేసి track చేయండి; solve అయ్యే వరకు steps clear గా కనిపిస్తాయి.',
      'समस्या आई तो तुरंत ticket बनाइए और track कीजिए; solve होने तक हर step साफ़ दिखता है.',
    ),
    Tx(
      'A pop-up alerts you on every new message. Even if the app is closed, you can reply fast.',
      'కొత్త message వచ్చినప్పుడల్లా pop-up వస్తుంది; app close ఉన్నా వెంటనే reply ఇవ్వొచ్చు, speed పెరుగుతుంది.',
      'नया message आते ही pop-up मिलता है; app बंद हो तब भी तुरंत reply देकर speed बनाए रखते हैं.',
    ),
    Tx(
      'Fast replies win customers. Answer every chat on time, together.',
      'అంతే, త్వరగా reply ఇస్తే customer మీదే. అందరం కలిసి, ప్రతి chat కి time కి స్పందిద్దాం.',
      'बस, जल्दी reply देंगे तो customer आपका। सब मिलकर हर chat का समय पर जवाब दें.',
    ),
  ],
  'automation': [
    Tx(
      'Set it once with templates. Confirmations, reminders, bills and review requests go at the right time automatically.',
      'ఒక్కసారి templates set చేస్తే చాలు; confirmation, reminder, bill, review request—ప్రతి మెసేజ్ సరైన time కి automatic గా వెళ్తుంది.',
      'एक बार templates set करिए; confirmation, reminder, bill, review request—हर message सही time पर अपने आप जाता है.',
    ),
    Tx(
      'Now a WhatsApp reminder goes before every visit. Customers remember, and missed appointments come down.',
      'ఇప్పుడు ప్రతి visit ముందు WhatsApp reminder వెళ్తుంది; కస్టమర్ గుర్తు పెట్టుకుని వస్తాడు, miss అయ్యే appointments తగ్గుతాయి.',
      'अब हर visit से पहले WhatsApp reminder जाता है; ग्राहक याद रखता है, miss होने वाले appointments कम होते हैं.',
    ),
    Tx(
      'For your online shop, send cart reminders and back-in-stock alerts. Interested people return and finish the order.',
      'ఆన్‌లైన్ shop కి cart reminders, back-in-stock alerts పంపండి; interest ఉన్నవాళ్లు తిరిగి వచ్చి order complete చేస్తారు.',
      'Online shop के लिए cart reminders और back-in-stock alerts भेजिए; interested लोग लौटकर order complete करते हैं.',
    ),
    Tx(
      'After each visit or order, we ask how it went. Happy customers leave more good reviews.',
      'సర్వీస్ లేదా order తర్వాత చిన్నగా అడిగితే చాలు; happy customers వెంటనే మంచి review వదిలేస్తారు.',
      'Service या order के बाद हल्का-सा पूछ लीजिए; happy customers तुरंत अच्छा review छोड़ देते हैं.',
    ),
    Tx(
      'Set it once, it works every day. Less follow-up work for you and your staff.',
      'కాబట్టి ఒకసారి set చేస్తే రోజూ పని; మీకు, staff కి follow-up పని తగ్గి, time సేవ్ అవుతుంది.',
      'तो एक बार set करें, रोज़ काम करेगा; आपके और staff के follow-up का काम कम होकर time बचेगा.',
    ),
  ],
  'ads': [
    Tx(
      'Our team plans and runs ads on Instagram, Facebook and Google, tailored to your business and area.',
      'మా team మీ కోసం Instagram, Facebook, Google లో ads plan చేసి run చేస్తుంది—మీ business, మీ area కి tailor చేసి.',
      'हमारी team आपके लिए Instagram, Facebook, Google पर ads plan कर run करती है—आपके business और area के मुताबिक.',
    ),
    Tx(
      'Now when they tap your ad, it becomes a WhatsApp chat. People message you directly.',
      'ఇప్పుడు ad పై tap చేస్తే, వెంటనే WhatsApp chat open అవుతుంది; people మీకు direct గా message చేస్తారు.',
      'अब ad पर tap करते ही तुरंत WhatsApp chat खुलती है; लोग सीधे आपको message करते हैं.',
    ),
    Tx(
      'No waiting, even at night. The A I replies at once, and you get the booking or order.',
      'రాత్రైనా wait అవసరం లేదు—A I వెంటనే reply ఇచ్చి, మీరు booking లేదా order పొందుతారు.',
      'रात में भी wait नहीं—A I तुरंत reply देता है, और आपको booking या order मिलता है.',
    ),
    Tx(
      'We handle posts, reels and photos. You still see every chat that comes in, and can reply fast.',
      'పోస్టులు, reels, photos మా team తయారు చేస్తుంది; వచ్చిన ప్రతి chat మీకు కనిపించి, మీరు వెంటనే స్పందించగలరు.',
      'Posts, reels, photos हमारी team बनाती है; आने वाली हर chat आपको दिखती है, और आप तुरंत जवाब दे पाते हैं.',
    ),
    Tx(
      'Grow faster with ads and WhatsApp. In More, open Grow your business and ask our team.',
      'కాబట్టి ads, WhatsApp తో growth వేగంగా ఉంటుంది. More లో Grow your business open చేసి, మా team ని ping చేయండి.',
      'तो ads और WhatsApp से growth तेज़। More में Grow your business खोलें और हमारी team को ping करें।',
    ),
  ],
};
