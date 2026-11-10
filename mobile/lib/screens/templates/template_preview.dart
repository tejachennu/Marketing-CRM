import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../ui/theme.dart';
import 'template_model.dart';

IconData categoryIcon(String category) => switch (category) {
  'UTILITY' => Icons.build_outlined,
  'AUTHENTICATION' => Icons.key_outlined,
  _ => Icons.campaign_outlined,
};

IconData typeIcon(String type) => switch (type) {
  'carousel' => Icons.view_carousel_outlined,
  'catalog' => Icons.storefront_outlined,
  'mpm' => Icons.grid_view,
  'spm' => Icons.shopping_bag_outlined,
  'product_carousel' => Icons.view_week_outlined,
  'lto' => Icons.timer_outlined,
  'coupon' => Icons.confirmation_number_outlined,
  'flow' => Icons.checklist,
  'call_permission' => Icons.phone_in_talk_outlined,
  'order_details' => Icons.receipt_long_outlined,
  'otp' => Icons.password,
  _ => Icons.chat_outlined,
};

/// The category as a round icon: Marketing, Utility or Authentication (or the type's icon).
class CategoryIcon extends StatelessWidget {
  const CategoryIcon({super.key, required this.category, this.size = 44, this.type});
  final String category;
  final String? type;
  final double size;
  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (category) {
      'UTILITY' => (const Color(0xFFE7F0FD), const Color(0xFF0064E0)),
      'AUTHENTICATION' => (const Color(0xFFFEF4D6), const Color(0xFF8A6100)),
      _ => (Brand.bubble, Brand.blue),
    };
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
      child: Icon(type == null ? categoryIcon(category) : typeIcon(type!), size: size * 0.5, color: fg),
    );
  }
}

/// WhatsApp text formatting: *bold*, _italic_, ~strike~ and ```mono```.
class WaText extends StatelessWidget {
  const WaText(this.text, {super.key, this.style});
  final String text;
  final TextStyle? style;
  static final _marks = RegExp(r'(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[^`]+```)');
  @override
  Widget build(BuildContext context) {
    final base = style ?? const TextStyle(fontSize: 14.5, height: 1.35, color: Brand.text);
    final spans = <TextSpan>[];
    var at = 0;
    for (final m in _marks.allMatches(text)) {
      if (m.start > at) spans.add(TextSpan(text: text.substring(at, m.start)));
      final s = m.group(0)!;
      spans.add(switch (s[0]) {
        '*' => TextSpan(
          text: s.substring(1, s.length - 1),
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        '_' => TextSpan(
          text: s.substring(1, s.length - 1),
          style: const TextStyle(fontStyle: FontStyle.italic),
        ),
        '~' => TextSpan(
          text: s.substring(1, s.length - 1),
          style: const TextStyle(decoration: TextDecoration.lineThrough),
        ),
        _ => TextSpan(
          text: s.substring(3, s.length - 3),
          style: const TextStyle(fontFamily: 'monospace'),
        ),
      });
      at = m.end;
    }
    if (at < text.length) spans.add(TextSpan(text: text.substring(at)));
    return Text.rich(TextSpan(style: base, children: spans));
  }
}

/// How the template looks on a customer's phone, as WhatsApp Manager previews it. Samples or the
/// {{variables}} as written, switched at the top.
class TemplatePreview extends StatefulWidget {
  const TemplatePreview({super.key, required this.draft, this.localMedia = const {}});
  final Map draft;

  /// Photos picked on this phone for the header or cards ("header", "card:0"…), shown in place of the upload.
  final Map<String, Uint8List> localMedia;
  @override
  State<TemplatePreview> createState() => _TemplatePreviewState();
}

class _TemplatePreviewState extends State<TemplatePreview> {
  bool _samples = true;

  Widget _button(String type, String text) {
    final icon = switch (type) {
      'QUICK_REPLY' => Icons.reply,
      'VOICE_CALL' => Icons.phone_in_talk_outlined,
      'ORDER_DETAILS' => Icons.credit_card,
      'MPM' || 'SPM' => Icons.shopping_bag_outlined,
      'URL' => Icons.open_in_new,
      'PHONE_NUMBER' => Icons.call_outlined,
      'COPY_CODE' || 'OTP' => Icons.copy,
      'CATALOG' => Icons.grid_view,
      _ => Icons.checklist,
    };
    return Container(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: Color(0x14000000))),
      ),
      padding: const EdgeInsets.symmetric(vertical: 9),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 15, color: const Color(0xFF027EB5)),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              text.isEmpty ? 'Button' : text,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: Color(0xFF027EB5), fontWeight: FontWeight.w600, fontSize: 13.5),
            ),
          ),
        ],
      ),
    );
  }

  Widget _media(String format, {String? key, String? preview, double height = 140}) {
    final local = key == null ? null : widget.localMedia[key];
    if (local != null && format == 'IMAGE') {
      return ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Image.memory(local, height: height, width: double.infinity, fit: BoxFit.cover),
      );
    }
    if ((preview ?? '').startsWith('http') && format == 'IMAGE') {
      return ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Image.network(preview!, height: height, width: double.infinity, fit: BoxFit.cover, errorBuilder: (_, _, _) => _mediaBox(format, height)),
      );
    }
    return _mediaBox(format, height);
  }

  Widget _mediaBox(String format, double height) => Container(
    height: height,
    width: double.infinity,
    decoration: BoxDecoration(color: const Color(0xFFE1E5E9), borderRadius: BorderRadius.circular(8)),
    child: Icon(
      switch (format) {
        'VIDEO' => Icons.videocam_outlined,
        'DOCUMENT' => Icons.description_outlined,
        'LOCATION' => Icons.location_on_outlined,
        _ => Icons.image_outlined,
      },
      size: 36,
      color: Brand.faint,
    ),
  );

  Widget _bubble(List<Widget> children, {double width = 300}) => Container(
    constraints: BoxConstraints(maxWidth: width),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: const BorderRadius.only(topRight: Radius.circular(10), bottomLeft: Radius.circular(10), bottomRight: Radius.circular(10)),
      boxShadow: const [BoxShadow(color: Color(0x22000000), blurRadius: 1, offset: Offset(0, 1))],
    ),
    clipBehavior: Clip.antiAlias,
    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
  );

  @override
  Widget build(BuildContext context) {
    final d = widget.draft;
    final type = '${d['type']}';
    final samples = (d['samples'] as Map?) ?? const {};
    String fill(String? text, Map s, [String prefix = '']) => _samples ? fillSamples(text, s, prefix) : (text ?? '');
    var body = fill('${d['body'] ?? ''}', samples);
    var footer = ['lto', 'carousel', 'product_carousel'].contains(type) ? '' : '${d['footer'] ?? ''}';
    var buttons = <(String, String)>[
      if (type != 'call_permission')
        for (final b in (d['buttons'] as List? ?? const []).cast<Map>()) ('${b['type']}', b['type'] == 'COPY_CODE' ? 'Copy offer code' : '${b['text'] ?? ''}'),
    ];
    if (type == 'otp') {
      final otp = otpPreviewText(d);
      body = otp.body;
      footer = otp.footer;
      final o = (d['otp'] as Map?) ?? const {};
      buttons = [('OTP', o['type'] == 'COPY_CODE' ? '${o['buttonText'] ?? 'Copy code'}' : '${o['autofillText'] ?? 'Autofill'}')];
    }
    if (type == 'catalog') buttons = [('CATALOG', 'View catalog')];
    if (type == 'mpm') buttons = [('MPM', 'View items')];
    if (type == 'spm') buttons = [('SPM', 'View')];
    if (type == 'order_details') buttons = [('ORDER_DETAILS', 'Review and pay')];
    final copyCode = (d['buttons'] as List? ?? const []).cast<Map>().where((b) => b['type'] == 'COPY_CODE').firstOrNull;
    final header = '${d['headerFormat'] ?? 'NONE'}';

    final main = _bubble([
      if (type == 'spm')
        Padding(
          padding: const EdgeInsets.all(4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _media('IMAGE'),
              const Padding(
                padding: EdgeInsets.fromLTRB(6, 6, 6, 0),
                child: Text('Product name', style: TextStyle(fontWeight: FontWeight.w700)),
              ),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 6),
                child: Text('₹499', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
              ),
            ],
          ),
        ),
      if (!['otp', 'carousel', 'product_carousel', 'spm'].contains(type) && header != 'NONE')
        header == 'TEXT'
            ? Padding(
                padding: const EdgeInsets.fromLTRB(10, 8, 10, 0),
                child: Text(
                  fill('${d['headerText'] ?? ''}', samples, 'header:').isEmpty ? 'Header' : fill('${d['headerText'] ?? ''}', samples, 'header:'),
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                ),
              )
            : Padding(
                padding: const EdgeInsets.all(4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _media(header, key: 'header', preview: d['headerPreview'] as String?),
                    if (header == 'LOCATION')
                      const Padding(
                        padding: EdgeInsets.fromLTRB(6, 4, 6, 0),
                        child: Text('Location sent with each message', style: TextStyle(fontSize: 12, color: Brand.muted)),
                      ),
                  ],
                ),
              ),
      if (type == 'lto')
        Container(
          margin: const EdgeInsets.fromLTRB(4, 4, 4, 0),
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(color: Brand.page, borderRadius: BorderRadius.circular(8)),
          child: Row(
            children: [
              const CircleAvatar(
                radius: 16,
                backgroundColor: Brand.bubble,
                child: Icon(Icons.schedule, size: 16, color: Brand.blue),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${(d['lto'] as Map?)?['text'] ?? 'Expiring offer!'}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    if ((d['lto'] as Map?)?['hasExpiration'] != false) const Text('Ends in 1 day', style: TextStyle(fontSize: 12, color: Brand.muted)),
                    if ('${copyCode?['example'] ?? ''}'.isNotEmpty) Text('Code ${copyCode!['example']}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                  ],
                ),
              ),
            ],
          ),
        ),
      Padding(
        padding: const EdgeInsets.fromLTRB(10, 6, 10, 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (body.isEmpty) const Text('Your message body appears here.', style: TextStyle(color: Brand.faint)) else WaText(body),
            if (footer.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(footer, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
              ),
            if (type == 'mpm')
              Container(
                margin: const EdgeInsets.only(top: 6),
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: Brand.page, borderRadius: BorderRadius.circular(8)),
                child: const Row(
                  children: [
                    Icon(Icons.shopping_bag_outlined, color: Brand.faint),
                    SizedBox(width: 8),
                    Text('Product name · ₹499', style: TextStyle(fontSize: 13)),
                  ],
                ),
              ),
            if (type == 'order_details')
              Container(
                margin: const EdgeInsets.only(top: 6),
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: Brand.page, borderRadius: BorderRadius.circular(8)),
                child: const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Order #ORD-1042 · ₹1,121', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                    Text('2 items · set when you send it', style: TextStyle(fontSize: 12, color: Brand.muted)),
                  ],
                ),
              ),
            const Align(
              alignment: Alignment.centerRight,
              child: Text('11:59', style: TextStyle(fontSize: 11, color: Brand.muted)),
            ),
          ],
        ),
      ),
      if (type == 'call_permission')
        Container(
          decoration: const BoxDecoration(
            border: Border(top: BorderSide(color: Color(0x14000000))),
          ),
          padding: const EdgeInsets.all(8),
          child: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Allow calls from this business?', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
              SizedBox(height: 6),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Allow',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Color(0xFF027EB5)),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      "Don't allow",
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Color(0xFF027EB5)),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      if (type != 'carousel') ...[for (final b in buttons.take(3)) _button(b.$1, b.$2), if (buttons.length > 3) _button('LIST', 'See all options')],
    ]);

    final cards = <Widget>[
      if (type == 'carousel')
        for (final (i, c) in (d['cards'] as List? ?? const []).cast<Map>().indexed)
          _bubble(width: 210, [
            Padding(
              padding: const EdgeInsets.all(4),
              child: _media('${c['headerFormat']}', key: 'card:$i', preview: c['headerPreview'] as String?, height: 110),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 2, 10, 6),
              child: WaText(fill('${c['body'] ?? ''}', (c['samples'] as Map?) ?? const {}).isEmpty ? 'Card text' : fill('${c['body'] ?? ''}', (c['samples'] as Map?) ?? const {})),
            ),
            for (final b in (c['buttons'] as List? ?? const []).cast<Map>()) _button('${b['type']}', b['type'] == 'COPY_CODE' ? 'Copy offer code' : '${b['text'] ?? ''}'),
          ]),
      if (type == 'product_carousel')
        for (var i = 0; i < ((d['productCards'] as num?)?.toInt() ?? 2); i++)
          _bubble(width: 180, [
            Padding(padding: const EdgeInsets.all(4), child: _media('IMAGE', height: 100)),
            const Padding(
              padding: EdgeInsets.fromLTRB(10, 2, 10, 6),
              child: Text('Product name · ₹499', style: TextStyle(fontSize: 13)),
            ),
            _button('SPM', 'View'),
          ]),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (type != 'otp')
          Align(
            alignment: Alignment.centerRight,
            child: SegmentedButton<bool>(
              segments: const [
                ButtonSegment(value: true, label: Text('Samples')),
                ButtonSegment(value: false, label: Text('Variables')),
              ],
              selected: {_samples},
              showSelectedIcon: false,
              style: const ButtonStyle(visualDensity: VisualDensity.compact),
              onSelectionChanged: (v) => setState(() => _samples = v.first),
            ),
          ),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: Brand.chatBg, borderRadius: BorderRadius.circular(16)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              main,
              if (cards.isNotEmpty) ...[
                const SizedBox(height: 8),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [for (final c in cards) Padding(padding: const EdgeInsets.only(right: 8), child: c)],
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
