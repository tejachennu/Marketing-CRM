import 'package:flutter_test/flutter_test.dart';

import 'release_helpers.dart';

/// On the free trial without WhatsApp connected: Front Desk and bills work; chats ask to connect.
void main() {
  final r = releaseApp(whatsapp: false);

  testWidgets('Front Desk and Bills open without WhatsApp; Chats asks to connect (small phone)', (tester) async {
    await useApp(tester, r.app, width: 320, height: 640, () async {
      expect(r.app.whatsappOn, isFalse);
      expect(find.text('Bookings'), findsWidgets, reason: 'Front Desk opens without WhatsApp');
      await tapText(tester, 'Bills');
      expect(find.textContaining('Connect WhatsApp'), findsNothing);
      await tapText(tester, r.app.instagramOn ? 'WhatsApp' : 'Chats');
      expect(find.text('Connect WhatsApp to use chats'), findsOneWidget);
      expect(await reach(tester, find.text('WhatsApp us to connect')), findsOneWidget);
    });
  });

  testWidgets('More offers to connect WhatsApp', (tester) async {
    await useApp(tester, r.app, () async {
      await tapText(tester, 'More');
      expect(find.text('Connect your WhatsApp'), findsOneWidget);
    });
  });
}
