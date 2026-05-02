import React, { useMemo } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import CommunitySlider from '@react-native-community/slider';

import useThemeColors from '@/app/contexts/ThemeColors';
import ThemedText from '../ThemedText';

type SliderSize = 's' | 'm' | 'l';

interface SliderProps {
  className?: string;
  style?: StyleProp<ViewStyle>;
  value?: number;
  initialValue?: number;
  onValueChange?: (value: number) => void;
  label?: string;
  maxValue?: number;
  minValue?: number;
  step?: number;
  size?: SliderSize;
}

const sizeStyles = {
  s: {
    labelText: 'text-xs',
    valueText: 'text-xs',
    height: 28,
  },
  m: {
    labelText: 'text-sm',
    valueText: 'text-sm',
    height: 36,
  },
  l: {
    labelText: 'text-base',
    valueText: 'text-base',
    height: 44,
  },
};

const Slider = ({
  className = '',
  style,
  value,
  initialValue,
  onValueChange,
  label,
  maxValue = 100,
  minValue = 0,
  step = 1,
  size = 'm',
}: SliderProps) => {
  const colors = useThemeColors();
  const currentSize = sizeStyles[size];
  const effectiveValue = value ?? initialValue ?? minValue;
  const decimalPoints = useMemo(() => (step >= 1 ? 0 : String(step).split('.')[1]?.length || 0), [step]);

  return (
    <View className={`w-full ${className}`} style={style}>
      {label && (
        <View className="flex-row justify-between mb-2">
          <ThemedText className={currentSize.labelText}>{label}</ThemedText>
          <ThemedText className={currentSize.valueText} selectable>
            {effectiveValue.toFixed(decimalPoints)}
          </ThemedText>
        </View>
      )}

      <CommunitySlider
        style={{ width: '100%', height: currentSize.height }}
        value={effectiveValue}
        minimumValue={minValue}
        maximumValue={maxValue}
        step={step}
        onValueChange={onValueChange}
        minimumTrackTintColor={colors.highlight}
        maximumTrackTintColor={colors.secondary}
        thumbTintColor={colors.highlight}
      />
    </View>
  );
};

export default Slider;
