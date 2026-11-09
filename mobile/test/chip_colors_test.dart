import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wama_mobile/ui/theme.dart';

/// Chip text must be readable on every chip type, picked or not (it once came out invisible on phones).
void main() {
  testWidgets('Chip text colours: grey when not picked, dark green when picked', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(),
        home: Scaffold(
          body: Wrap(
            children: [
              ChoiceChip(label: const Text('choice off'), selected: false, onSelected: (_) {}),
              ChoiceChip(label: const Text('choice on'), selected: true, onSelected: (_) {}),
              ActionChip(label: const Text('action'), onPressed: () {}),
              InputChip(label: const Text('input'), onDeleted: () {}),
              FilterChip(label: const Text('filter off'), selected: false, onSelected: (_) {}),
              FilterChip(label: const Text('filter on'), selected: true, onSelected: (_) {}),
            ],
          ),
        ),
      ),
    );
    Color colorOf(String text) {
      final paragraph = tester.renderObject<RenderParagraph>(find.text(text));
      Color? found;
      paragraph.text.visitChildren((span) {
        found ??= span.style?.color;
        return found == null;
      });
      return found ?? const Color(0x00000000);
    }

    for (final t in ['choice off', 'action', 'input', 'filter off']) {
      expect(colorOf(t), Brand.textSoft, reason: t);
    }
    for (final t in ['choice on', 'filter on']) {
      expect(colorOf(t), const Color(0xFF15603E), reason: t);
    }
  });
}
