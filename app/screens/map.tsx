import React, { useMemo, useRef, useState } from 'react';
import { Keyboard, Text, TextInput, View } from 'react-native';
import ActionSheet, { ActionSheetRef, FlatList } from 'react-native-actions-sheet';
import MapView from 'react-native-maps';
import { router } from 'expo-router';

import CustomCard from '@/components/CustomCard';
import Header, { HeaderIcon } from '@/components/Header';
import Icon from '@/components/Icon';
import ImageCarousel from '@/components/ImageCarousel';
import PriceMarker from '@/components/PriceMarker';
import ThemedText from '@/components/ThemedText';
import useThemeColors from '@/app/contexts/ThemeColors';
import { useForeclosures } from '@/app/hooks/useForeclosures';
import { PHILIPPINES_REGION, normalizePropertyType } from '@/lib/foreclosures';

const MapScreen = () => {
    const colors = useThemeColors();
    const actionSheetRef = useRef<ActionSheetRef>(null);
    const mapRef = useRef<MapView>(null);
    const { properties, loading, formatPrice, filterProperties, getRegionForProperties } = useForeclosures();
    const [query, setQuery] = useState('');
    const [activeQuery, setActiveQuery] = useState('');

    React.useEffect(() => {
        actionSheetRef.current?.show();
    }, []);

    const filteredProperties = useMemo(() => {
        return activeQuery ? filterProperties({ query: activeQuery }) : properties;
    }, [activeQuery, filterProperties, properties]);

    const mappedProperties = useMemo(
        () => filteredProperties.filter((property) => property.hasValidCoordinates),
        [filteredProperties]
    );

    React.useEffect(() => {
        if (loading) return;

        const nextRegion = getRegionForProperties(mappedProperties);
        const timer = setTimeout(() => {
            if (mappedProperties.length > 1) {
                mapRef.current?.fitToCoordinates(
                    mappedProperties.map((property) => property.coordinates),
                    {
                        edgePadding: { top: 80, right: 60, bottom: 320, left: 60 },
                        animated: true,
                    }
                );
            } else {
                mapRef.current?.animateToRegion(nextRegion, 350);
            }
        }, 250);

        return () => clearTimeout(timer);
    }, [activeQuery, getRegionForProperties, loading, mappedProperties]);

    const handleSearchSubmit = () => {
        Keyboard.dismiss();
        setActiveQuery(query.trim());
    };

    const clearSearch = () => {
        setQuery('');
        setActiveQuery('');
        Keyboard.dismiss();
        mapRef.current?.animateToRegion(PHILIPPINES_REGION, 350);
    };

    const resultLabel = activeQuery
        ? `${filteredProperties.length} result${filteredProperties.length === 1 ? '' : 's'} for "${activeQuery}"`
        : `${properties.length} foreclosure properties`;

    return (
        <>
            <Header
                title="Map"
                rightComponents={[
                    <HeaderIcon key="filters" icon="SlidersHorizontal" href="/screens/filters" />
                ]}
            />

            <View className="flex-1 bg-light-primary dark:bg-dark-primary">
                <View className="px-global pb-3 bg-light-primary dark:bg-dark-primary z-50">
                    <View className="flex-row items-center gap-2 rounded-2xl bg-light-secondary dark:bg-dark-secondary px-4 py-3">
                        <Icon name="Search" size={18} strokeWidth={2.2} />
                        <TextInput
                            value={query}
                            onChangeText={setQuery}
                            onSubmitEditing={handleSearchSubmit}
                            returnKeyType="search"
                            placeholder="Search province, city, or address"
                            placeholderTextColor={colors.placeholder}
                            className="flex-1 text-base text-black dark:text-white"
                        />
                        {!!query && (
                            <Icon name="X" size={18} onPress={clearSearch} />
                        )}
                    </View>
                </View>

                <MapView
                    ref={mapRef}
                    className="w-full flex-1"
                    initialRegion={PHILIPPINES_REGION}
                >
                    {!loading && mappedProperties.map((property) => (
                        <PriceMarker
                            key={property.id}
                            coordinate={property.coordinates}
                            price={formatPrice(property.price)}
                            title={property.title}
                            onPress={() => router.push(`/screens/product-detail?id=${property.id}`)}
                        />
                    ))}
                </MapView>

                {!loading && activeQuery && filteredProperties.length > 0 && mappedProperties.length === 0 && (
                    <View style={{ left: 20, right: 20 }} className="absolute top-28 rounded-2xl bg-light-primary dark:bg-dark-primary px-4 py-3">
                        <ThemedText className="font-semibold">No mapped properties for this search</ThemedText>
                        <ThemedText className="text-xs opacity-70 mt-1" selectable>
                            Matching listings exist, but their coordinates are missing from the local dataset.
                        </ThemedText>
                    </View>
                )}

                {!loading && activeQuery && filteredProperties.length === 0 && (
                    <View style={{ left: 20, right: 20 }} className="absolute top-28 rounded-2xl bg-light-primary dark:bg-dark-primary px-4 py-3">
                        <ThemedText className="font-semibold">No properties found</ThemedText>
                        <ThemedText className="text-xs opacity-70 mt-1" selectable>
                            Try a broader location such as Bulacan, Cebu, Cavite, or Metro Manila.
                        </ThemedText>
                    </View>
                )}

                <ActionSheet
                    ref={actionSheetRef}
                    isModal={false}
                    CustomHeaderComponent={
                        <View className="w-full items-center justify-center mb-2">
                            <View className="w-14 h-2 mt-2 rounded-full bg-light-secondary dark:bg-dark-secondary" />
                            <ThemedText className="font-bold mt-3" selectable>{resultLabel}</ThemedText>
                            <ThemedText className="text-xs opacity-60 mt-1" selectable>{mappedProperties.length} shown on map</ThemedText>
                        </View>
                    }
                    backgroundInteractionEnabled
                    initialSnapIndex={1}
                    snapPoints={[12, 100]}
                    gestureEnabled
                    overdrawEnabled={false}
                    closable={false}
                    containerStyle={{
                        borderTopLeftRadius: 20,
                        borderTopRightRadius: 20,
                        backgroundColor: colors.bg
                    }}
                >
                    <FlatList
                        className="px-2"
                        data={filteredProperties}
                        showsVerticalScrollIndicator={false}
                        keyExtractor={(item) => item.id}
                        ListEmptyComponent={
                            <View className="py-12 items-center px-global">
                                <Icon name="SearchX" size={36} strokeWidth={1.5} />
                                <ThemedText className="mt-3 font-semibold">No matching properties</ThemedText>
                                <ThemedText className="text-center text-xs opacity-70 mt-1" selectable>
                                    Clear the search or try a nearby city or province.
                                </ThemedText>
                            </View>
                        }
                        renderItem={({ item }) => (
                            <CustomCard
                                padding="md"
                                className="my-0 w-full overflow-hidden"
                                href={`/screens/product-detail?id=${item.id}`}
                            >
                                <ImageCarousel
                                    rounded="xl"
                                    height={180}
                                    className="w-full"
                                    images={[item.image]}
                                />
                                <View className="pb-global pt-2">
                                    <View className="flex-row items-start justify-between gap-3">
                                        <ThemedText className="text-base font-bold flex-1" numberOfLines={2}>{item.title}</ThemedText>
                                        <View className="bg-highlight/10 px-2 py-0.5 rounded">
                                            <ThemedText className="text-[10px] font-bold text-highlight">{item.source}</ThemedText>
                                        </View>
                                    </View>
                                    <Text className="text-sm text-light-subtext dark:text-dark-subtext" numberOfLines={2}>
                                        {item.location} • {normalizePropertyType(item.type)}
                                    </Text>
                                    <ThemedText className="font-bold text-lg mt-2" selectable>{formatPrice(item.price)}</ThemedText>
                                </View>
                            </CustomCard>
                        )}
                    />
                </ActionSheet>
            </View>
        </>
    );
};

export default MapScreen;
