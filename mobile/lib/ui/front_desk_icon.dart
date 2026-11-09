import 'package:flutter/material.dart';

/// The Front Desk mark (a service bell on a reception desk), drawn like the web app's icon.
class FrontDeskIcon extends StatelessWidget {
  const FrontDeskIcon({super.key, this.size = 24, this.color, this.strokeWidth = 2});
  final double size;
  final Color? color;
  final double strokeWidth;

  @override
  Widget build(BuildContext context) => CustomPaint(
        size: Size.square(size),
        painter: _FrontDeskPainter(color ?? IconTheme.of(context).color ?? Colors.black, strokeWidth),
      );
}

class _FrontDeskPainter extends CustomPainter {
  _FrontDeskPainter(this.color, this.strokeWidth);
  final Color color;
  final double strokeWidth;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 24;
    canvas.scale(s);
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    canvas.drawLine(const Offset(12, 6), const Offset(12, 8.5), paint); // knob
    canvas.drawLine(const Offset(10.5, 6), const Offset(13.5, 6), paint); // cap
    canvas.drawArc(Rect.fromCenter(center: const Offset(12, 13.5), width: 11, height: 10), 3.14159, 3.14159, false, paint); // bell
    canvas.drawLine(const Offset(3, 13.5), const Offset(21, 13.5), paint); // desk top
    final desk = Path()
      ..moveTo(4.5, 13.5)
      ..lineTo(4.5, 20)
      ..lineTo(19.5, 20)
      ..lineTo(19.5, 13.5);
    canvas.drawPath(desk, paint);
    canvas.drawLine(const Offset(10, 16.75), const Offset(14, 16.75), paint); // drawer
  }

  @override
  bool shouldRepaint(covariant _FrontDeskPainter old) => old.color != color || old.strokeWidth != strokeWidth;
}
