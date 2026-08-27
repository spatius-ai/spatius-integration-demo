import 'package:flutter/material.dart';

import 'config_check_page.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const AvatarBackendDemoApp());
}

class AvatarBackendDemoApp extends StatelessWidget {
  const AvatarBackendDemoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AvatarKit Backend Mode Demo',
      theme: ThemeData(
        colorSchemeSeed: Colors.blue,
        useMaterial3: true,
      ),
      home: const ConfigCheckPage(),
    );
  }
}
