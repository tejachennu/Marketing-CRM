import 'package:flutter/material.dart';

/// The Front Desk mark: a billing counter (cash register). Outline normally, filled when its tab is open (as the
/// icons in WhatsApp's bottom bar).
class FrontDeskIcon extends StatelessWidget {
  const FrontDeskIcon({super.key, this.size = 24, this.color, this.filled = false});
  final double size;
  final Color? color;
  final bool filled;

  @override
  Widget build(BuildContext context) => Icon(filled ? Icons.point_of_sale : Icons.point_of_sale_outlined, size: size, color: color);
}
