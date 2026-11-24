import 'package:flutter_test/flutter_test.dart';

import 'release_helpers.dart';

/// The trial has ended and a staff member (who cannot pay) opens the app.
void main() {
  final r = releaseApp(billing: 'ended', staff: true);

  testWidgets('staff are told to ask the owner, with no pay button', (tester) async {
    await useApp(tester, r.app, () async {
      expect(find.text('Choose a plan'), findsNothing);
      expect(find.textContaining('Ask the owner of Glow Salon'), findsOneWidget);
      expect(await reach(tester, find.text('Check again')), findsOneWidget);
    });
  });
}
