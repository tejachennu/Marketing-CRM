import 'package:flutter/material.dart';

/// The short explainer videos shown on the welcome pages and in More (owner, 25 Nov 2026: "video presentations ... how
/// they will benefit ... multi language ... running ads, maintaining chats, auto replies, automation ... on the
/// onboarding itself"). Each video is a few animated scenes with a caption; every word is in English, Telugu and
/// Hindi. No brand name in the words (the name may change) and no made-up numbers.

/// The languages the videos speak.
const videoLanguages = [('en', 'English'), ('te', 'తెలుగు'), ('hi', 'हिंदी')];

/// One text in each language.
class Tx {
  const Tx(this.en, this.te, this.hi);
  final String en;
  final String te;
  final String hi;
  String of(String lang) => switch (lang) {
    'te' => te,
    'hi' => hi,
    _ => en,
  };
}

/// How a scene moves (see explainer_scenes.dart).
enum SceneKind { picture, flow, chat, languages, inbox, alerts, ad, growth, end }

/// A chat bubble in a chat scene: from the customer, from the business (or its AI), or a card (booking, order).
class Bubble {
  const Bubble(this.text, {this.me = false, this.card = false, this.button, this.ai = false});
  final Tx text;
  final bool me;
  final bool card;

  /// A reply button under the message ("Book now")
  final Tx? button;

  /// Marked "AI reply"
  final bool ai;
}

/// A labelled icon (flow steps, notifications, inbox rows, ad pieces).
class Item {
  const Item(this.icon, this.label, {this.sub, this.tag});
  final IconData icon;
  final Tx label;
  final Tx? sub;

  /// A small chip on the row ("Lakshmi", "3")
  final Tx? tag;
}

class Scene {
  const Scene(this.kind, {required this.title, required this.line, this.ms = 5600, this.picture, this.chat = const [], this.items = const [], this.clock});
  final SceneKind kind;
  final Tx title;
  final Tx line;
  final int ms;

  /// The drawing in assets/images for picture scenes, e.g. "desk"
  final String? picture;
  final List<Bubble> chat;
  final List<Item> items;

  /// A time shown on the phone ("11:42 pm"): replies at night
  final String? clock;
}

class Explainer {
  const Explainer({required this.id, required this.icon, required this.title, required this.summary, required this.scenes});
  final String id;
  final IconData icon;
  final Tx title;
  final Tx summary;
  final List<Scene> scenes;

  int get seconds => (scenes.fold<int>(0, (sum, s) => sum + s.ms) / 1000).round();
}

const _endLine = Tx('Start free for 14 days. No card needed.', '14 రోజులు ఉచితంగా వాడండి. కార్డ్ అవసరం లేదు.', '14 दिन मुफ़्त इस्तेमाल करें। कार्ड की ज़रूरत नहीं।');

const explainers = <Explainer>[
  // ── 1. The whole picture ──
  Explainer(
    id: 'grow',
    icon: Icons.trending_up,
    title: Tx('How we grow your business', 'మీ బిజినెస్‌ని మేము ఎలా పెంచుతాం', 'हम आपका बिज़नेस कैसे बढ़ाते हैं'),
    summary: Tx('From the first message to a happy, returning customer.', 'మొదటి మెసేజ్ నుంచి మళ్ళీ మళ్ళీ వచ్చే కస్టమర్ వరకు.', 'पहले मैसेज से लेकर बार-बार आने वाले ग्राहक तक।'),
    scenes: [
      Scene(
        SceneKind.picture,
        picture: 'welcome',
        title: Tx('Your shop, open on WhatsApp 24 × 7', 'మీ షాప్ WhatsApp లో 24 × 7 ఓపెన్', 'आपकी दुकान WhatsApp पर 24 × 7 खुली'),
        line: Tx(
          'Customers message you any time. The app replies, books and sends bills for you.',
          'కస్టమర్లు ఎప్పుడైనా మెసేజ్ చేయొచ్చు. యాప్ మీ తరఫున జవాబిస్తుంది, బుక్ చేస్తుంది, బిల్ పంపుతుంది.',
          'ग्राहक कभी भी मैसेज कर सकते हैं। ऐप आपकी तरफ़ से जवाब देता है, बुकिंग करता है और बिल भेजता है।',
        ),
        items: [
          Item(Icons.event_available, Tx('New booking', 'కొత్త బుకింగ్', 'नई बुकिंग')),
          Item(Icons.receipt_long, Tx('Bill paid', 'బిల్ కట్టారు', 'बिल भर दिया')),
          Item(Icons.star_rounded, Tx('5-star review', '5 స్టార్ రివ్యూ', '5 स्टार रिव्यू')),
        ],
      ),
      Scene(
        SceneKind.flow,
        title: Tx('From first message to happy customer', 'మొదటి మెసేజ్ నుంచి హ్యాపీ కస్టమర్ వరకు', 'पहले मैसेज से खुश ग्राहक तक'),
        line: Tx('Every step happens in one app.', 'ప్రతి స్టెప్ ఒకే యాప్‌లో.', 'हर कदम एक ही ऐप में।'),
        items: [
          Item(Icons.campaign_outlined, Tx('Ad', 'యాడ్', 'ऐड')),
          Item(Icons.chat_outlined, Tx('Chat', 'చాట్', 'चैट')),
          Item(Icons.smart_toy_outlined, Tx('AI reply', 'AI జవాబు', 'AI जवाब')),
          Item(Icons.event_available_outlined, Tx('Booking', 'బుకింగ్', 'बुकिंग')),
          Item(Icons.receipt_long_outlined, Tx('Bill', 'బిల్', 'बिल')),
          Item(Icons.star_outline_rounded, Tx('Review', 'రివ్యూ', 'रिव्यू')),
        ],
      ),
      Scene(
        SceneKind.chat,
        clock: '11:48 pm',
        title: Tx('Replies in seconds, even at midnight', 'అర్ధరాత్రి అయినా సెకన్లలో జవాబు', 'आधी रात को भी सेकंडों में जवाब'),
        line: Tx('The AI answers from your own prices and timings.', 'మీ ధరలు, టైమింగ్స్ చూసి AI జవాబిస్తుంది.', 'AI आपकी अपनी कीमतों और टाइमिंग के हिसाब से जवाब देता है।'),
        chat: [
          Bubble(Tx('Hi, are you open on Sunday?', 'హాయ్, ఆదివారం ఓపెన్ ఉంటారా?', 'नमस्ते, क्या रविवार को खुला है?')),
          Bubble(
            Tx('Yes! 10 am to 8 pm. Shall I book a time for you?', 'అవును! ఉదయం 10 నుంచి రాత్రి 8 వరకు. మీకు టైమ్ బుక్ చేయనా?', 'हाँ! सुबह 10 से रात 8 बजे तक। आपके लिए समय बुक कर दूँ?'),
            me: true,
            ai: true,
          ),
          Bubble(Tx('Yes, 11 am please', 'సరే, 11 గంటలకి', 'हाँ, 11 बजे')),
          Bubble(Tx('Booked · Sunday, 11:00 am', 'బుక్ అయింది · ఆదివారం, ఉదయం 11:00', 'बुक हो गया · रविवार, 11:00 बजे'), me: true, card: true),
        ],
      ),
      Scene(
        SceneKind.alerts,
        title: Tx('Reminders, bills and reviews go out by themselves', 'రిమైండర్లు, బిల్లులు, రివ్యూలు ఆటోమేటిక్‌గా వెళ్తాయి', 'रिमाइंडर, बिल और रिव्यू अपने आप जाते हैं'),
        line: Tx('Less phone work, fewer missed visits.', 'ఫోన్ పని తక్కువ, మిస్ అయ్యే అపాయింట్‌మెంట్లు తక్కువ.', 'फ़ोन का काम कम, छूटने वाले अपॉइंटमेंट कम।'),
        items: [
          Item(Icons.notifications_active_outlined, Tx('Reminder sent to Ravi', 'రవికి రిమైండర్ వెళ్ళింది', 'रवि को रिमाइंडर भेजा गया'), sub: Tx('Visit tomorrow, 10 am', 'రేపు ఉదయం 10 గంటలకు', 'कल सुबह 10 बजे')),
          Item(Icons.receipt_long_outlined, Tx('Bill paid · ₹1,250', 'బిల్ కట్టారు · ₹1,250', 'बिल भर दिया · ₹1,250'), sub: Tx('GST invoice sent on WhatsApp', 'GST ఇన్‌వాయిస్ WhatsApp లో వెళ్ళింది', 'GST इनवॉइस WhatsApp पर भेजा गया')),
          Item(Icons.star_rounded, Tx('New review ★★★★★', 'కొత్త రివ్యూ ★★★★★', 'नया रिव्यू ★★★★★'), sub: Tx('"Loved the service!"', '"సర్వీస్ చాలా బాగుంది!"', '"सर्विस बहुत अच्छी लगी!"')),
          Item(Icons.local_shipping_outlined, Tx('Order #1024 delivered', 'ఆర్డర్ #1024 డెలివరీ అయింది', 'ऑर्डर #1024 डिलीवर हो गया'), sub: Tx('Customer told on WhatsApp', 'కస్టమర్‌కి WhatsApp లో చెప్పాం', 'ग्राहक को WhatsApp पर बताया गया')),
        ],
      ),
      Scene(SceneKind.end, ms: 4200, title: Tx('More customers, less work', 'ఎక్కువ కస్టమర్లు, తక్కువ పని', 'ज़्यादा ग्राहक, कम काम'), line: _endLine),
    ],
  ),

  // ── 2. Auto replies ──
  Explainer(
    id: 'replies',
    icon: Icons.smart_toy_outlined,
    title: Tx('Auto replies in your customer\'s language', 'కస్టమర్ భాషలోనే ఆటో రిప్లై', 'ग्राहक की भाषा में ऑटो रिप्लाई'),
    summary: Tx('The AI answers questions day and night, and hands over to you when needed.', 'AI రాత్రీ పగలూ జవాబిస్తుంది, అవసరమైతే చాట్ మీకు అప్పగిస్తుంది.', 'AI दिन-रात सवालों के जवाब देता है, और ज़रूरत हो तो चैट आपको सौंप देता है।'),
    scenes: [
      Scene(
        SceneKind.chat,
        clock: '11:42 pm',
        title: Tx('A customer asks at 11:42 pm', 'రాత్రి 11:42 కి కస్టమర్ అడిగారు', 'रात 11:42 बजे ग्राहक ने पूछा'),
        line: Tx('The AI replies in seconds, with your prices.', 'AI సెకన్లలో మీ ధరలతో జవాబిస్తుంది.', 'AI सेकंडों में आपकी कीमतें बताकर जवाब देता है।'),
        chat: [
          Bubble(Tx('How much is a hair spa?', 'హెయిర్ స్పా ఎంత?', 'हेयर स्पा कितने का है?')),
          Bubble(
            Tx('Hair spa is ₹1,000 and takes 45 minutes. Would you like to book?', 'హెయిర్ స్పా ₹1,000, 45 నిమిషాలు పడుతుంది. బుక్ చేయనా?', 'हेयर स्पा ₹1,000 का है और 45 मिनट लगते हैं। बुक कर दूँ?'),
            me: true,
            ai: true,
            button: Tx('Book now', 'ఇప్పుడే బుక్ చేయండి', 'अभी बुक करें'),
          ),
        ],
      ),
      Scene(
        SceneKind.languages,
        title: Tx('English, తెలుగు, हिंदी and mixes', 'English, తెలుగు, हिंदी, మిక్స్ చేసినా సరే', 'English, తెలుగు, हिंदी और मिली-जुली भाषा'),
        line: Tx('It answers in the language your customer writes in.', 'కస్టమర్ ఏ భాషలో రాస్తే అదే భాషలో జవాబిస్తుంది.', 'ग्राहक जिस भाषा में लिखे, उसी में जवाब देता है।'),
        // The same in every language: it shows the AI answering Telugu, Tenglish and Hinglish
        chat: [
          Bubble(Tx('ఆదివారం షాప్ ఓపెన్ ఉంటుందా?', 'ఆదివారం షాప్ ఓపెన్ ఉంటుందా?', 'ఆదివారం షాప్ ఓపెన్ ఉంటుందా?')),
          Bubble(Tx('అవును! ఉదయం 10 నుంచి రాత్రి 8 వరకు 😊', 'అవును! ఉదయం 10 నుంచి రాత్రి 8 వరకు 😊', 'అవును! ఉదయం 10 నుంచి రాత్రి 8 వరకు 😊'), me: true, ai: true),
          Bubble(Tx('Kal appointment mil sakta hai?', 'Kal appointment mil sakta hai?', 'Kal appointment mil sakta hai?')),
          Bubble(Tx('Haan ji, kal 11 baje free hai. Book kar doon?', 'Haan ji, kal 11 baje free hai. Book kar doon?', 'Haan ji, kal 11 baje free hai. Book kar doon?'), me: true, ai: true),
        ],
      ),
      Scene(
        SceneKind.chat,
        title: Tx('Hands over to you when needed', 'అవసరమైతే చాట్ మీకు అప్పగిస్తుంది', 'ज़रूरत हो तो चैट आपको सौंप देता है'),
        line: Tx('Tricky questions come to your team, with the full chat.', 'కష్టమైన ప్రశ్నలు పూర్తి చాట్‌తో సహా మీ టీమ్‌కి వస్తాయి.', 'मुश्किल सवाल पूरी चैट के साथ आपकी टीम के पास आते हैं।'),
        chat: [
          Bubble(Tx('I want to speak to the owner, please.', 'ఓనర్‌తో మాట్లాడాలి.', 'मुझे मालिक से बात करनी है।')),
          Bubble(Tx('Sure! I have told the team. They will reply soon.', 'సరే! టీమ్‌కి చెప్పాను. వాళ్ళు కాసేపట్లో జవాబిస్తారు.', 'ज़रूर! मैंने टीम को बता दिया है। वो जल्दी जवाब देंगे।'), me: true, ai: true),
          Bubble(Tx('Chat handed to you · AI paused', 'చాట్ మీకు వచ్చింది · AI ఆపేశాం', 'चैट आपको सौंपी गई · AI बंद'), me: true, card: true),
        ],
      ),
      Scene(
        SceneKind.picture,
        picture: 'desk',
        title: Tx('It learns from your business', 'మీ బిజినెస్ నుంచే నేర్చుకుంటుంది', 'यह आपके बिज़नेस से सीखता है'),
        line: Tx('Add your services, prices and answers once. The AI uses them every time.', 'మీ సర్వీసులు, ధరలు, జవాబులు ఒక్కసారి పెట్టండి. AI ప్రతిసారీ వాటినే వాడుతుంది.', 'अपनी सर्विस, कीमतें और जवाब एक बार डालें। AI हर बार उन्हीं का इस्तेमाल करता है।'),
        items: [
          Item(Icons.sell_outlined, Tx('Prices', 'ధరలు', 'कीमतें')),
          Item(Icons.schedule, Tx('Timings', 'టైమింగ్స్', 'टाइमिंग')),
          Item(Icons.local_offer_outlined, Tx('Offers', 'ఆఫర్లు', 'ऑफ़र')),
        ],
      ),
      Scene(SceneKind.end, ms: 4200, title: Tx('Never miss a customer again', 'ఇక ఏ కస్టమర్‌నీ మిస్ చేసుకోరు', 'अब कोई ग्राहक नहीं छूटेगा'), line: Tx('Your AI assistant works day and night.', 'మీ AI అసిస్టెంట్ రాత్రీ పగలూ పని చేస్తుంది.', 'आपका AI असिस्टेंट दिन-रात काम करता है।')),
    ],
  ),

  // ── 3. Team inbox ──
  Explainer(
    id: 'inbox',
    icon: Icons.forum_outlined,
    title: Tx('One WhatsApp inbox for your team', 'మీ టీమ్ అంతటికీ ఒకే WhatsApp ఇన్‌బాక్స్', 'पूरी टीम के लिए एक WhatsApp इनबॉक्स'),
    summary: Tx('Everyone answers from one number. No chat is missed.', 'అందరూ ఒకే నంబర్ నుంచి జవాబిస్తారు. ఏ చాట్ మిస్ అవ్వదు.', 'सब एक ही नंबर से जवाब देते हैं। कोई चैट नहीं छूटती।'),
    scenes: [
      Scene(
        SceneKind.inbox,
        title: Tx('All chats in one place', 'అన్ని చాట్‌లు ఒకే చోట', 'सारी चैट एक जगह'),
        line: Tx('Your whole team uses one WhatsApp number, on the app and the website.', 'మీ టీమ్ అంతా ఒకే WhatsApp నంబర్ వాడుతుంది, యాప్‌లో, వెబ్‌సైట్‌లో.', 'आपकी पूरी टीम एक ही WhatsApp नंबर इस्तेमाल करती है, ऐप और वेबसाइट दोनों पर।'),
        items: [
          Item(Icons.person, Tx('Kavya Iyer', 'కావ్య', 'काव्या'), sub: Tx('Is the bridal package available?', 'బ్రైడల్ ప్యాకేజ్ ఉందా?', 'ब्राइडल पैकेज मिलेगा?'), tag: Tx('2', '2', '2')),
          Item(Icons.person, Tx('Rahul Verma', 'రాహుల్', 'राहुल'), sub: Tx('Thanks, see you at 5!', 'థ్యాంక్స్, 5 కి కలుద్దాం!', 'थैंक्स, 5 बजे मिलते हैं!')),
          Item(Icons.person, Tx('Sneha Reddy', 'స్నేహ', 'स्नेहा'), sub: Tx('Can I pay by UPI?', 'UPI తో కట్టొచ్చా?', 'क्या UPI से पैसे दे सकती हूँ?'), tag: Tx('1', '1', '1')),
          Item(Icons.person, Tx('Arjun Rao', 'అర్జున్', 'अर्जुन'), sub: Tx('Order received, thank you', 'ఆర్డర్ వచ్చింది, థ్యాంక్యూ', 'ऑर्डर मिल गया, थैंक यू')),
        ],
      ),
      Scene(
        SceneKind.inbox,
        title: Tx('Give each chat to the right person', 'ప్రతి చాట్‌ని సరైన వ్యక్తికి ఇవ్వండి', 'हर चैट सही इंसान को दें'),
        line: Tx('Staff see the chats given to them. Nothing gets lost.', 'ఎవరికి ఇచ్చిన చాట్‌లు వాళ్ళకి కనిపిస్తాయి. ఏదీ మిస్ అవ్వదు.', 'स्टाफ़ को सिर्फ़ अपनी चैट दिखती हैं। कुछ नहीं छूटता।'),
        items: [
          Item(Icons.person, Tx('Kavya Iyer', 'కావ్య', 'काव्या'), sub: Tx('Is the bridal package available?', 'బ్రైడల్ ప్యాకేజ్ ఉందా?', 'ब्राइडल पैकेज मिलेगा?'), tag: Tx('Lakshmi', 'లక్ష్మి', 'लक्ष्मी')),
          Item(Icons.person, Tx('Sneha Reddy', 'స్నేహ', 'स्नेहा'), sub: Tx('Can I pay by UPI?', 'UPI తో కట్టొచ్చా?', 'क्या UPI से पैसे दे सकती हूँ?'), tag: Tx('Ravi', 'రవి', 'रवि')),
          Item(Icons.person, Tx('Rahul Verma', 'రాహుల్', 'राहुल'), sub: Tx('Thanks, see you at 5!', 'థ్యాంక్స్, 5 కి కలుద్దాం!', 'थैंक्स, 5 बजे मिलते हैं!'), tag: Tx('Anitha', 'అనిత', 'अनीता')),
        ],
      ),
      Scene(
        SceneKind.alerts,
        title: Tx('Turn problems into tickets', 'సమస్యలను టికెట్లుగా మార్చండి', 'शिकायत को टिकट बनाइए'),
        line: Tx('Track every complaint until it is solved.', 'ప్రతి కంప్లైంట్ పరిష్కారం అయ్యే వరకు ట్రాక్ చేయండి.', 'हर शिकायत को हल होने तक ट्रैक करें।'),
        items: [
          Item(Icons.confirmation_number_outlined, Tx('Ticket: Bill not received', 'టికెట్: బిల్ రాలేదు', 'टिकट: बिल नहीं मिला'), sub: Tx('Given to Ravi', 'రవికి ఇచ్చాం', 'रवि को दिया गया')),
          Item(Icons.send_outlined, Tx('Bill sent again on WhatsApp', 'బిల్ మళ్ళీ WhatsApp లో పంపాం', 'बिल फिर से WhatsApp पर भेजा')),
          Item(Icons.check_circle_outline, Tx('Ticket solved', 'టికెట్ పరిష్కారం అయింది', 'टिकट हल हो गया'), sub: Tx('Customer is happy', 'కస్టమర్ హ్యాపీ', 'ग्राहक खुश है')),
        ],
      ),
      Scene(
        SceneKind.alerts,
        title: Tx('A pop-up for every new message', 'ప్రతి కొత్త మెసేజ్‌కి పాప్-అప్', 'हर नए मैसेज पर पॉप-अप'),
        line: Tx('Reply fast, even when the app is closed.', 'యాప్ మూసి ఉన్నా వెంటనే జవాబివ్వండి.', 'ऐप बंद हो तब भी जल्दी जवाब दें।'),
        items: [
          Item(Icons.chat, Tx('New message from Kavya', 'కావ్య నుంచి కొత్త మెసేజ్', 'काव्या का नया मैसेज'), sub: Tx('Is the bridal package available?', 'బ్రైడల్ ప్యాకేజ్ ఉందా?', 'ब्राइडल पैकेज मिलेगा?')),
          Item(Icons.event_available, Tx('New booking request', 'కొత్త బుకింగ్ రిక్వెస్ట్', 'नई बुकिंग रिक्वेस्ट'), sub: Tx('Tomorrow, 4 pm · Facial', 'రేపు సాయంత్రం 4 · ఫేషియల్', 'कल शाम 4 बजे · फ़ेशियल')),
        ],
      ),
      Scene(SceneKind.end, ms: 4200, title: Tx('Fast replies win customers', 'త్వరగా జవాబిస్తే కస్టమర్లు మీవాళ్ళే', 'जल्दी जवाब, ज़्यादा ग्राहक'), line: Tx('Answer every chat on time, together.', 'అందరూ కలిసి, ప్రతి చాట్‌కి టైమ్‌కి జవాబివ్వండి.', 'सब मिलकर हर चैट का समय पर जवाब दें।')),
    ],
  ),

  // ── 4. Automation ──
  Explainer(
    id: 'automation',
    icon: Icons.bolt_outlined,
    title: Tx('Things that happen by themselves', 'ఆటోమేటిక్‌గా జరిగే పనులు', 'काम जो अपने आप होते हैं'),
    summary: Tx('Confirmations, reminders, bills, review requests and cart reminders.', 'కన్ఫర్మేషన్లు, రిమైండర్లు, బిల్లులు, రివ్యూ అడగడం, కార్ట్ రిమైండర్లు.', 'कन्फ़र्मेशन, रिमाइंडर, बिल, रिव्यू माँगना और कार्ट रिमाइंडर।'),
    scenes: [
      Scene(
        SceneKind.alerts,
        title: Tx('Messages that send themselves', 'ఆటోమేటిక్‌గా వెళ్ళే మెసేజ్‌లు', 'मैसेज जो अपने आप जाते हैं'),
        line: Tx('Set them up once. They go out at the right time, every time.', 'ఒక్కసారి సెట్ చేయండి. ప్రతిసారీ సరైన టైమ్‌కి వెళ్తాయి.', 'एक बार सेट करें। हर बार सही समय पर जाते हैं।'),
        items: [
          Item(Icons.event_available_outlined, Tx('Booking confirmed', 'బుకింగ్ కన్ఫర్మ్ అయింది', 'बुकिंग कन्फ़र्म'), sub: Tx('Right after booking', 'బుక్ చేసిన వెంటనే', 'बुकिंग के तुरंत बाद')),
          Item(Icons.alarm, Tx('Reminder: visit tomorrow', 'రిమైండర్: రేపు అపాయింట్‌మెంట్', 'रिमाइंडर: कल अपॉइंटमेंट'), sub: Tx('A day before', 'ఒక రోజు ముందు', 'एक दिन पहले')),
          Item(Icons.receipt_long_outlined, Tx('Your bill is ready', 'మీ బిల్ రెడీ', 'आपका बिल तैयार है'), sub: Tx('After the visit', 'సర్వీస్ అయ్యాక', 'अपॉइंटमेंट के बाद')),
          Item(Icons.star_outline_rounded, Tx('How was your visit?', 'మా సర్వీస్ ఎలా ఉంది?', 'आपका अनुभव कैसा रहा?'), sub: Tx('Asks for a review', 'రివ్యూ అడుగుతుంది', 'रिव्यू माँगता है')),
        ],
      ),
      Scene(
        SceneKind.chat,
        title: Tx('Reminders cut missed visits', 'రిమైండర్లతో మిస్ అయ్యే అపాయింట్‌మెంట్లు తగ్గుతాయి', 'रिमाइंडर से छूटने वाले अपॉइंटमेंट कम'),
        line: Tx('Customers get a WhatsApp message before every visit.', 'ప్రతి అపాయింట్‌మెంట్‌కి ముందు కస్టమర్‌కి WhatsApp మెసేజ్ వెళ్తుంది.', 'हर अपॉइंटमेंट से पहले ग्राहक को WhatsApp मैसेज जाता है।'),
        chat: [
          Bubble(Tx('Reminder: your haircut is tomorrow at 10 am. See you!', 'రిమైండర్: మీ హెయిర్‌కట్ రేపు ఉదయం 10 గంటలకు. కలుద్దాం!', 'रिमाइंडर: आपका हेयरकट कल सुबह 10 बजे है। मिलते हैं!'), me: true, button: Tx('Change time', 'టైమ్ మార్చండి', 'समय बदलें')),
          Bubble(Tx('Thanks, I will be there 👍', 'థ్యాంక్స్, వస్తాను 👍', 'थैंक्स, मैं आ जाऊँगा 👍')),
        ],
      ),
      Scene(
        SceneKind.chat,
        title: Tx('Get back lost sales', 'పోయిన సేల్స్ మళ్ళీ తెచ్చుకోండి', 'छूटी हुई बिक्री वापस पाएँ'),
        line: Tx('Cart reminders and back-in-stock messages for your online shop.', 'మీ ఆన్‌లైన్ షాప్‌కి కార్ట్ రిమైండర్లు, స్టాక్ వచ్చిందని మెసేజ్‌లు.', 'आपकी ऑनलाइन दुकान के लिए कार्ट रिमाइंडर और स्टॉक वापस आने के मैसेज।'),
        chat: [
          Bubble(Tx('You left 2 items in your cart. They are still waiting for you!', 'మీ కార్ట్‌లో 2 వస్తువులు ఉండిపోయాయి. అవి ఇంకా మీ కోసం ఉన్నాయి!', 'आपके कार्ट में 2 चीज़ें रह गईं। वो अभी भी आपका इंतज़ार कर रही हैं!'), me: true, button: Tx('Order now', 'ఇప్పుడే ఆర్డర్ చేయండి', 'अभी ऑर्डर करें')),
          Bubble(Tx('Order placed · ₹1,297 · UPI', 'ఆర్డర్ అయింది · ₹1,297 · UPI', 'ऑर्डर हो गया · ₹1,297 · UPI'), me: true, card: true),
        ],
      ),
      Scene(
        SceneKind.picture,
        picture: 'shop',
        title: Tx('More good reviews', 'మంచి రివ్యూలు ఎక్కువ వస్తాయి', 'ज़्यादा अच्छे रिव्यू'),
        line: Tx('After each visit or order we ask how it went. Happy customers leave reviews.', 'ప్రతి సర్వీస్ లేదా ఆర్డర్ తర్వాత ఎలా ఉందో అడుగుతాం. హ్యాపీ కస్టమర్లు రివ్యూ ఇస్తారు.', 'हर अपॉइंटमेंट या ऑर्डर के बाद हम पूछते हैं कि कैसा रहा। खुश ग्राहक रिव्यू देते हैं।'),
        items: [
          Item(Icons.star_rounded, Tx('★★★★★ "Very good!"', '★★★★★ "చాలా బాగుంది!"', '★★★★★ "बहुत बढ़िया!"')),
          Item(Icons.star_rounded, Tx('★★★★★ "Fast delivery"', '★★★★★ "త్వరగా డెలివరీ అయింది"', '★★★★★ "जल्दी डिलीवरी"')),
        ],
      ),
      Scene(SceneKind.end, ms: 4200, title: Tx('Set it once, it works every day', 'ఒక్కసారి సెట్ చేస్తే, రోజూ పని చేస్తుంది', 'एक बार सेट करें, रोज़ काम करे'), line: Tx('Less follow-up work for you and your staff.', 'మీకు, మీ స్టాఫ్‌కి ఫాలో-అప్ పని తగ్గుతుంది.', 'आपके और आपके स्टाफ़ के लिए फ़ॉलो-अप का काम कम।')),
    ],
  ),

  // ── 5. Ads and social media ──
  Explainer(
    id: 'ads',
    icon: Icons.campaign_outlined,
    title: Tx('Ads that bring customers to your WhatsApp', 'మీ WhatsApp కి కస్టమర్లను తెచ్చే యాడ్స్', 'ऐड जो ग्राहकों को आपके WhatsApp पर लाएँ'),
    summary: Tx('Our team runs your ads and social media. Every click becomes a chat.', 'మా టీమ్ మీ యాడ్స్, సోషల్ మీడియా చూసుకుంటుంది. ప్రతి క్లిక్ ఒక చాట్ అవుతుంది.', 'हमारी टीम आपके ऐड और सोशल मीडिया संभालती है। हर क्लिक एक चैट बन जाता है।'),
    scenes: [
      Scene(
        SceneKind.ad,
        title: Tx('Our team runs your ads', 'మా టీమ్ మీ యాడ్స్ రన్ చేస్తుంది', 'हमारी टीम आपके ऐड चलाती है'),
        line: Tx('On Instagram, Facebook and Google, made for your business and your area.', 'Instagram, Facebook, Google లో, మీ బిజినెస్‌కి, మీ ఏరియాకి తగ్గట్టు.', 'Instagram, Facebook और Google पर, आपके बिज़नेस और इलाके के हिसाब से।'),
        items: [
          Item(Icons.local_offer_outlined, Tx('Festival offer: 20% off', 'పండగ ఆఫర్: 20% తగ్గింపు', 'फ़ेस्टिवल ऑफ़र: 20% छूट'), sub: Tx('Your shop · Sponsored', 'మీ షాప్ · స్పాన్సర్డ్', 'आपकी दुकान · स्पॉन्सर्ड')),
          Item(Icons.chat, Tx('Send message', 'మెసేజ్ పంపండి', 'मैसेज भेजें')),
        ],
      ),
      Scene(
        SceneKind.chat,
        title: Tx('Ad clicks become WhatsApp chats', 'యాడ్ క్లిక్‌లు WhatsApp చాట్‌లు అవుతాయి', 'ऐड के क्लिक WhatsApp चैट बन जाते हैं'),
        line: Tx('People tap your ad and message you straight away.', 'యాడ్ నొక్కగానే నేరుగా మీకు మెసేజ్ చేస్తారు.', 'लोग आपके ऐड पर टैप करते ही सीधे आपको मैसेज करते हैं।'),
        chat: [
          Bubble(Tx('Hi! I saw your festival offer', 'హాయ్! మీ పండగ ఆఫర్ చూశాను', 'नमस्ते! मैंने आपका फ़ेस्टिवल ऑफ़र देखा')),
          Bubble(
            Tx('Welcome! 20% off all services till Sunday. Pick a time to book:', 'స్వాగతం! ఆదివారం వరకు అన్ని సర్వీసులపై 20% తగ్గింపు. బుక్ చేయడానికి టైమ్ ఎంచుకోండి:', 'स्वागत है! रविवार तक सभी सर्विस पर 20% छूट। बुक करने के लिए समय चुनें:'),
            me: true,
            ai: true,
            button: Tx('See times', 'టైమ్స్ చూడండి', 'समय देखें'),
          ),
        ],
      ),
      Scene(
        SceneKind.flow,
        title: Tx('The AI replies, you get the booking', 'AI జవాబిస్తుంది, మీకు బుకింగ్ వస్తుంది', 'AI जवाब देता है, आपको बुकिंग मिलती है'),
        line: Tx('No lead waits, even at night.', 'రాత్రి అయినా ఏ కస్టమరూ వెయిట్ చేయక్కర్లేదు.', 'रात को भी किसी ग्राहक को इंतज़ार नहीं करना पड़ता।'),
        items: [
          Item(Icons.campaign_outlined, Tx('Ad', 'యాడ్', 'ऐड')),
          Item(Icons.chat_outlined, Tx('WhatsApp', 'WhatsApp', 'WhatsApp')),
          Item(Icons.smart_toy_outlined, Tx('AI reply', 'AI జవాబు', 'AI जवाब')),
          Item(Icons.event_available_outlined, Tx('Booking or order', 'బుకింగ్ లేదా ఆర్డర్', 'बुकिंग या ऑर्डर')),
        ],
      ),
      Scene(
        SceneKind.growth,
        title: Tx('Social media, taken care of', 'సోషల్ మీడియా మేమే చూసుకుంటాం', 'सोशल मीडिया हम संभालते हैं'),
        line: Tx('Posts, reels and photos made by our team, and you see every chat that comes in.', 'పోస్టులు, రీల్స్, ఫోటోలు మా టీమ్ చేస్తుంది, వచ్చే ప్రతి చాట్ మీకు కనిపిస్తుంది.', 'पोस्ट, रील्स और फ़ोटो हमारी टीम बनाती है, और आने वाली हर चैट आपको दिखती है।'),
        items: [
          Item(Icons.photo_camera_outlined, Tx('Posts', 'పోస్టులు', 'पोस्ट')),
          Item(Icons.movie_outlined, Tx('Reels', 'రీల్స్', 'रील्स')),
          Item(Icons.forum_outlined, Tx('Chats from ads', 'యాడ్స్ నుంచి చాట్‌లు', 'ऐड से आई चैट')),
        ],
      ),
      Scene(SceneKind.end, ms: 4200, title: Tx('Grow faster with ads and WhatsApp', 'యాడ్స్, WhatsApp తో బిజినెస్ వేగంగా పెంచుకోండి', 'ऐड और WhatsApp से तेज़ी से बढ़ें'), line: Tx('Ask our team from More, then Grow your business.', 'More లో Grow your business నుంచి మా టీమ్‌ని అడగండి.', 'More में Grow your business खोलें और हमारी टीम से पूछें।')),
    ],
  ),
];

/// The words around the videos (gallery, player).
class VideoWords {
  static const watch = Tx('Watch', 'చూడండి', 'देखें');
  static const seeHow = Tx('See how it helps your business', 'ఇది మీ బిజినెస్‌కి ఎలా ఉపయోగపడుతుందో చూడండి', 'देखिए यह आपके बिज़नेस में कैसे मदद करता है');
  static const pickLanguage = Tx('Short videos, in your language', 'చిన్న వీడియోలు, మీ భాషలో', 'छोटे वीडियो, आपकी भाषा में');
  static const seconds = Tx('sec', 'సెకన్లు', 'सेकंड');
  static const next = Tx('Next video', 'తర్వాతి వీడియో', 'अगला वीडियो');
  static const again = Tx('Watch again', 'మళ్ళీ చూడండి', 'फिर से देखें');
  static const done = Tx('Done', 'అయింది', 'हो गया');
  static const watched = Tx('Watched', 'చూశారు', 'देख लिया');
  static const startFree = Tx('Start free for 14 days', '14 రోజులు ఉచితంగా మొదలుపెట్టండి', '14 दिन मुफ़्त शुरू करें');
  static const aiReply = Tx('AI reply', 'AI జవాబు', 'AI जवाब');
  static const online = Tx('online', 'ఆన్‌లైన్', 'ऑनलाइन');
  static const yourShop = Tx('Your shop', 'మీ షాప్', 'आपकी दुकान');
  static const chats = Tx('Chats', 'చాట్‌లు', 'चैट');
  static const reach = Tx('People reached', 'చూసినవాళ్ళు', 'देखने वाले');
}
