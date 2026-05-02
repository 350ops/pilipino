import React, { useState } from 'react';
import { View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';

import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import Header from '@/components/Header';
import Section from '@/components/layout/Section';
import ThemeFooter from '@/components/ThemeFooter';
import ThemedScroller from '@/components/ThemeScroller';
import ThemedText from '@/components/ThemedText';
import Switch from '@/components/forms/Switch';

export default function FiltersScreen() {
    const router = useRouter();
    const [maxPrice, setMaxPrice] = useState(5_000_000);

    const handleApplyFilters = () => {
        router.back();
    };

    return (
        <>
            <Header showBackButton title="Filters" />
            <ThemedScroller className="flex-1 bg-light-primary dark:bg-dark-primary">
                <Section
                    className="mb-7 pb-7 border-b border-light-secondary dark:border-dark-secondary"
                    title="Budget"
                    subtitle={`Up to ${new Intl.NumberFormat('en-PH', {
                        style: 'currency',
                        currency: 'PHP',
                        maximumFractionDigits: 0,
                    }).format(maxPrice)}`}
                >
                    <Slider
                        style={{ width: '100%', height: 40 }}
                        value={maxPrice}
                        minimumValue={500_000}
                        maximumValue={25_000_000}
                        onValueChange={setMaxPrice}
                        minimumTrackTintColor="#FF2358"
                        maximumTrackTintColor="rgba(0,0,0,0.2)"
                        step={250_000}
                    />
                </Section>

                <Section className="mb-7 pb-7 border-b border-light-secondary dark:border-dark-secondary" title="Property Type">
                    <View className="flex-row flex-wrap gap-2 mt-2">
                        <Chip icon="Home" label="House and Lot" size="lg" selectable />
                        <Chip icon="LandPlot" label="Residential Lot" size="lg" selectable />
                        <Chip icon="Building2" label="Condominium" size="lg" selectable />
                        <Chip icon="Warehouse" label="Commercial" size="lg" selectable />
                    </View>
                </Section>

                <Section className="mb-7 pb-7 border-b border-light-secondary dark:border-dark-secondary" title="Source">
                    <View className="flex-row flex-wrap gap-2 mt-2">
                        <Chip icon="Landmark" label="Pag-IBIG" size="lg" selectable />
                        <Chip icon="Building" label="BDO" size="lg" selectable />
                        <Chip icon="Building" label="BPI" size="lg" selectable />
                        <Chip icon="Building" label="Bank Listed" size="lg" selectable />
                    </View>
                </Section>

                <Section className="mb-7 pb-7 border-b border-light-secondary dark:border-dark-secondary" title="Due Diligence">
                    <View className="mt-4 gap-4">
                        <Switch label="Only show mapped properties" />
                        <Switch label="Available status only" />
                        <Switch label="Has lot or floor area" />
                    </View>
                </Section>

                <View className="pb-8">
                    <ThemedText className="text-xs opacity-60" selectable>
                        Filters are prepared for the local dataset MVP. Live bank/Pag-IBIG syncing can be added in a later phase.
                    </ThemedText>
                </View>
            </ThemedScroller>
            <ThemeFooter>
                <Button
                    title="Apply Filters"
                    rounded="full"
                    size="large"
                    className="bg-highlight"
                    textClassName="text-white"
                    onPress={handleApplyFilters}
                />
            </ThemeFooter>
        </>
    );
}
