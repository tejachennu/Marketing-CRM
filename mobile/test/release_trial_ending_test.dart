import 'package:flutter_test/flutter_test.dart';

import 'release_helpers.dart';

/// The last days of the free trial: a bar above the tabs says so and opens Billing.
void main() {
  final r = releaseApp(billing: 'trial2');

  testWidgets('a bar says 2 days are left and opens Billing (small phone)', (tester) async {
    await useApp(tester, r.app, width: 320, height: 640, () async {
      expect(find.textContaining('2 days left in your free trial'), findsOneWidget);
      await tester.tap(find.textContaining('2 days left in your free trial'));
      await settle(tester);
      expect(find.text('Billing'), findsWidgets);
    });
  });
}
