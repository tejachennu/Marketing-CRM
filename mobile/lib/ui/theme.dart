import 'package:flutter/material.dart';

/// WAMA CRM colours: navy, one blue, greys, and red only for things that need attention.
class Brand {
  static const navy = Color(0xFF0E1B3D);
  static const blue = Color(0xFF1D5BEA);
  static const blueHover = Color(0xFF174BC4);
  static const blueSoft = Color(0xFFEEF3FE);
  static const page = Color(0xFFF4F6FA);
  static const line = Color(0xFFE3E8F2);
  static const lineSoft = Color(0xFFEEF1F6);
  static const border = Color(0xFFD5DDEB);
  static const text = Color(0xFF0E1B3D);
  static const textSoft = Color(0xFF4A5672);
  static const muted = Color(0xFF6B7894);
  static const faint = Color(0xFF8A94A8);
  static const red = Color(0xFFB91C1C);
  static const redSoft = Color(0xFFFDF0F0);
}

ThemeData buildTheme() {
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(seedColor: Brand.blue, primary: Brand.blue, secondary: Brand.navy, error: Brand.red, surface: Colors.white),
    scaffoldBackgroundColor: Brand.page,
  );
  final rounded = RoundedRectangleBorder(borderRadius: BorderRadius.circular(12));
  OutlineInputBorder box(Color color, [double width = 1]) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(12),
    borderSide: BorderSide(color: color, width: width),
  );
  return base.copyWith(
    textTheme: base.textTheme.apply(bodyColor: Brand.text, displayColor: Brand.text),
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.white,
      foregroundColor: Brand.navy,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 1,
      shadowColor: Color(0x22000000),
      centerTitle: false,
      titleSpacing: 16,
      titleTextStyle: TextStyle(color: Brand.navy, fontSize: 21, fontWeight: FontWeight.w700, letterSpacing: -0.3),
    ),
    // White blocks on the light grey page, no heavy borders (like WhatsApp's settings)
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: Brand.lineSoft),
      ),
    ),
    listTileTheme: const ListTileThemeData(
      contentPadding: EdgeInsets.symmetric(horizontal: 16),
      titleTextStyle: TextStyle(color: Brand.text, fontSize: 16, fontWeight: FontWeight.w600),
      subtitleTextStyle: TextStyle(color: Brand.muted, fontSize: 13.5, height: 1.3),
      iconColor: Brand.textSoft,
      minLeadingWidth: 28,
    ),
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: Brand.blue,
      foregroundColor: Colors.white,
      elevation: 3,
      highlightElevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      extendedTextStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      dragHandleColor: Brand.border,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      titleTextStyle: const TextStyle(color: Brand.navy, fontSize: 19, fontWeight: FontWeight.w700),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: const WidgetStatePropertyAll(Colors.white),
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Brand.blue : Brand.border),
      trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: Brand.blue,
        foregroundColor: Colors.white,
        minimumSize: const Size(48, 48),
        shape: rounded,
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: Brand.navy,
        minimumSize: const Size(48, 48),
        side: const BorderSide(color: Brand.border),
        shape: rounded,
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: Brand.blue,
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      hintStyle: const TextStyle(color: Brand.faint),
      labelStyle: const TextStyle(color: Brand.textSoft),
      border: box(Brand.border),
      enabledBorder: box(Brand.border),
      focusedBorder: box(Brand.blue, 2),
      errorBorder: box(Brand.red),
    ),
    // WhatsApp-style chips: soft grey, the picked one light blue with a blue edge
    chipTheme: base.chipTheme.copyWith(
      backgroundColor: Brand.lineSoft,
      selectedColor: Brand.blueSoft,
      side: WidgetStateBorderSide.resolveWith((states) => states.contains(WidgetState.selected) ? const BorderSide(color: Brand.blue, width: 1.2) : const BorderSide(color: Colors.transparent)),
      // A real colour for each state (a chip with no text colour shows nothing on some phones)
      labelStyle: TextStyle(
        color: WidgetStateColor.resolveWith((states) => states.contains(WidgetState.selected) ? Brand.blue : (states.contains(WidgetState.disabled) ? Brand.faint : Brand.textSoft)),
        fontWeight: FontWeight.w600,
      ),
      secondaryLabelStyle: const TextStyle(color: Brand.blue, fontWeight: FontWeight.w700),
      iconTheme: const IconThemeData(color: Brand.textSoft, size: 18),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      showCheckmark: false,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: Brand.blueSoft,
      surfaceTintColor: Colors.transparent,
      height: 70,
      labelTextStyle: WidgetStateProperty.resolveWith((states) => TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: states.contains(WidgetState.selected) ? Brand.navy : Brand.muted)),
      iconTheme: WidgetStateProperty.resolveWith((states) => IconThemeData(color: states.contains(WidgetState.selected) ? Brand.blue : Brand.muted)),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Brand.blueSoft : Colors.white),
        foregroundColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Brand.blue : Brand.textSoft),
        side: const WidgetStatePropertyAll(BorderSide(color: Brand.border)),
        textStyle: const WidgetStatePropertyAll(TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
        minimumSize: const WidgetStatePropertyAll(Size(0, 44)),
      ),
    ),
    dividerTheme: const DividerThemeData(color: Brand.lineSoft, space: 1, thickness: 1),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating, backgroundColor: Brand.navy),
  );
}
