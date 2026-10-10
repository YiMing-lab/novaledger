import 'package:flutter/material.dart';

class CustomKeypad extends StatelessWidget {
  final ValueChanged<String> onKeyPressed;
  final VoidCallback onDelete;
  final VoidCallback onConfirm;
  final String confirmLabel;

  const CustomKeypad({
    super.key,
    required this.onKeyPressed,
    required this.onDelete,
    required this.onConfirm,
    this.confirmLabel = '完成',
  });

  Widget _buildKey(BuildContext context, String label, {int flex = 1, Color? color, VoidCallback? onTap}) {
    final theme = Theme.of(context);
    return Expanded(
      flex: flex,
      child: Padding(
        padding: const EdgeInsets.all(3.0),
        child: Material(
          color: color ?? theme.colorScheme.surfaceContainerHigh,
          borderRadius: BorderRadius.circular(12),
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: onTap ?? () => onKeyPressed(label),
            child: SizedBox(
              height: 52,
              child: Center(
                child: Text(
                  label,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                    color: color != null ? theme.colorScheme.onPrimary : theme.colorScheme.onSurface,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildIconKey(BuildContext context, IconData icon, VoidCallback onTap) {
    final theme = Theme.of(context);
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.all(3.0),
        child: Material(
          color: theme.colorScheme.surfaceContainerHigh,
          borderRadius: BorderRadius.circular(12),
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: onTap,
            child: SizedBox(
              height: 52,
              child: Center(
                child: Icon(icon, color: theme.colorScheme.onSurface),
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(8.0),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainer,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              _buildKey(context, '1'),
              _buildKey(context, '2'),
              _buildKey(context, '3'),
              _buildIconKey(context, Icons.backspace_outlined, onDelete),
            ],
          ),
          Row(
            children: [
              _buildKey(context, '4'),
              _buildKey(context, '5'),
              _buildKey(context, '6'),
              _buildKey(context, '+'),
            ],
          ),
          Row(
            children: [
              _buildKey(context, '7'),
              _buildKey(context, '8'),
              _buildKey(context, '9'),
              _buildKey(context, '-'),
            ],
          ),
          Row(
            children: [
              _buildKey(context, '.'),
              _buildKey(context, '0'),
              _buildKey(
                context,
                confirmLabel,
                flex: 2,
                color: theme.colorScheme.primary,
                onTap: onConfirm,
              ),
            ],
          ),
        ],
      ),
    );
  }
}
