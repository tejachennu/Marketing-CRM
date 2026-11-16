import 'package:flutter_test/flutter_test.dart';

import 'package:wama_mobile/screens/templates/template_widgets.dart';

/// Sending a template from a chat: blanks in the title and in button links are asked for too
/// (WhatsApp refuses the message when one is empty), filled in from the approved example.
void main() {
  test('Link and title blanks are found, with the approved example filled in', () {
    final parts = TemplateParts({
      'components': [
        {
          'type': 'HEADER',
          'format': 'TEXT',
          'text': 'Hi {{1}}',
          'example': {
            'header_text': ['Priya'],
          },
        },
        {'type': 'BODY', 'text': 'Hello {{1}}, thank you for visiting {{2}}.'},
        {
          'type': 'BUTTONS',
          'buttons': [
            {
              'type': 'URL',
              'text': 'Leave a review',
              'url': 'https://g.page/r/{{1}}',
              'example': ['https://g.page/r/CbX12/review'],
            },
            {'type': 'URL', 'text': 'Website', 'url': 'https://glow.in'},
            {'type': 'QUICK_REPLY', 'text': 'Stop'},
          ],
        },
      ],
    });
    expect(parts.blanks, ['1', '2']);
    expect(parts.extras.map((e) => e.key), ['header_text_1', 'button_url_1']);
    expect(parts.extras[0].suggested, 'Priya');
    expect(parts.extras[1].suggested, 'CbX12/review');
    expect(parts.extras[1].prefix, 'https://g.page/r/');
    expect(parts.extras[1].label, 'Link of the button "Leave a review"');
  });

  test('A link example with only its ending is used as it is', () {
    expect(urlExampleEnding({'url': 'https://x.in/{{1}}', 'example': ['abc']}), 'abc');
    expect(urlExampleEnding({'url': 'https://x.in/{{1}}', 'example': ['https://other.in/abc']}), '');
    expect(urlExampleEnding({'url': 'https://x.in/{{1}}'}), '');
  });
}
