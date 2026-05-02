import React, { useState } from 'react';
import { Share, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import Favorite from '@/components/Favorite';
import Header, { HeaderIcon } from '@/components/Header';
import Icon, { IconName } from '@/components/Icon';
import ImageCarousel from '@/components/ImageCarousel';
import Divider from '@/components/layout/Divider';
import ThemedScroller from '@/components/ThemeScroller';
import ThemedText from '@/components/ThemedText';
import { useForeclosures } from '@/app/hooks/useForeclosures';
import { formatArea, normalizePropertyType } from '@/lib/foreclosures';

const unavailable = 'Unavailable';

const PropertyDetail = () => {
    const [isFocused, setIsFocused] = useState(true);
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams<{ id?: string }>();
    const { loading, getPropertyById, formatPrice } = useForeclosures();
    const property = getPropertyById(params.id);

    useFocusEffect(
        React.useCallback(() => {
            setIsFocused(true);
            return () => {
                setIsFocused(false);
            };
        }, [])
    );

    const handleShare = async () => {
        if (!property) return;

        try {
            await Share.share({
                message: `${property.title}\nPrice: ${formatPrice(property.price)}\nSource: ${property.source}\nLocation: ${property.location}`,
                title: property.title
            });
        } catch (error) {
            console.error('Error sharing:', error);
        }
    };

    if (loading) {
        return (
            <View className="flex-1 bg-light-primary dark:bg-dark-primary">
                <Header variant="transparent" title="" showBackButton />
                <View className="flex-1 items-center justify-center px-global">
                    <ThemedText>Loading property...</ThemedText>
                </View>
            </View>
        );
    }

    if (!property) {
        return (
            <View className="flex-1 bg-light-primary dark:bg-dark-primary">
                <Header title="Property" showBackButton />
                <View className="flex-1 items-center justify-center px-global">
                    <Icon name="MapPinOff" size={46} strokeWidth={1.5} />
                    <ThemedText className="mt-4 text-xl font-semibold text-center">Property not found</ThemedText>
                    <ThemedText className="mt-2 text-sm text-center opacity-70" selectable>
                        This listing may be missing from the local foreclosure dataset.
                    </ThemedText>
                </View>
            </View>
        );
    }

    const rightComponents = [
        <Favorite key="fav" productName={property.title} size={25} isWhite />,
        <HeaderIcon key="share" icon="Share2" onPress={handleShare} isWhite href="0" />,
    ];

    const price = formatPrice(property.price);
    const propertyType = normalizePropertyType(property.type);

    return (
        <>
            {isFocused && <StatusBar style="light" translucent />}
            <Header variant="transparent" title="" rightComponents={rightComponents} showBackButton />
            <ThemedScroller className="px-0 bg-light-primary dark:bg-dark-primary">
                <ImageCarousel
                    images={[property.image]}
                    height={360}
                    paginationStyle="dots"
                />

                <View
                    style={{ borderTopLeftRadius: 30, borderTopRightRadius: 30 }}
                    className="p-global bg-light-primary dark:bg-dark-primary -mt-[30px]">
                    <View className="mb-6">
                        <View className="bg-highlight/10 self-start px-3 py-1 rounded-full mb-3">
                            <ThemedText className="text-xs font-bold text-highlight" selectable>{property.source}</ThemedText>
                        </View>
                        <ThemedText className="text-3xl font-semibold" selectable>{property.title}</ThemedText>
                        <ThemedText className="text-2xl font-bold mt-2 text-highlight" selectable>{price}</ThemedText>
                        <ThemedText className="text-sm mt-2 opacity-70" selectable>{property.location}</ThemedText>
                    </View>

                    <View className="bg-light-secondary dark:bg-dark-secondary p-4 rounded-2xl mb-8 flex-row flex-wrap">
                        <InfoChip icon="LandPlot" label={formatArea(property.lotArea)} />
                        <InfoChip icon="Home" label={formatArea(property.floorArea)} />
                        <InfoChip icon="Building2" label={propertyType} />
                        <InfoChip icon="BadgeCheck" label={property.status || unavailable} />
                    </View>

                    {!!property.description && (
                        <ThemedText className="text-base leading-6" selectable>{property.description}</ThemedText>
                    )}

                    <Divider className="my-8" />

                    <View className="bg-light-secondary dark:bg-dark-secondary p-5 rounded-2xl">
                        <ThemedText className="text-lg font-bold mb-4">Foreclosure Details</ThemedText>
                        <DetailRow label="Indicative Price" value={price} isBold />
                        <DetailRow label="Listing Source" value={property.source || unavailable} />
                        <DetailRow label="Sale Mode" value={property.saleMode || unavailable} />
                        <DetailRow label="Occupancy" value={property.occupancy || unavailable} />
                        <DetailRow label="Status" value={property.status || unavailable} />
                        <DetailRow label="Auction Date" value={property.auctionDate || 'TBA'} />
                    </View>

                    <View className="mt-8 mb-10">
                        <ThemedText className="text-lg font-bold mb-4">Location</ThemedText>
                        {property.hasValidCoordinates ? (
                            <View className="h-56 rounded-2xl overflow-hidden bg-neutral-200">
                                <MapView
                                    style={{ flex: 1 }}
                                    scrollEnabled={false}
                                    zoomEnabled={false}
                                    rotateEnabled={false}
                                    pitchEnabled={false}
                                    initialRegion={{
                                        ...property.coordinates,
                                        latitudeDelta: 0.04,
                                        longitudeDelta: 0.04,
                                    }}
                                >
                                    <Marker coordinate={property.coordinates} title={property.title} description={price} />
                                </MapView>
                            </View>
                        ) : (
                            <View className="h-40 rounded-2xl bg-light-secondary dark:bg-dark-secondary items-center justify-center px-6">
                                <Icon name="MapPinOff" size={30} strokeWidth={1.5} />
                                <ThemedText className="mt-3 text-center font-semibold">Map unavailable</ThemedText>
                                <ThemedText className="mt-1 text-center text-xs opacity-70" selectable>
                                    This local listing does not include coordinates yet.
                                </ThemedText>
                            </View>
                        )}
                    </View>
                </View>
            </ThemedScroller>

            <View
                style={{ paddingBottom: insets.bottom + 10 }}
                className="flex-row items-center justify-between px-global pt-4 bg-light-primary dark:bg-dark-primary border-t border-neutral-200 dark:border-dark-secondary"
            >
                <View className="flex-1 pr-4">
                    <ThemedText className="text-xs opacity-60">Contact source for due diligence</ThemedText>
                    <ThemedText className="text-lg font-bold" numberOfLines={1} selectable>{property.source}</ThemedText>
                </View>
                <Button
                    title="Inquire"
                    className="bg-highlight px-8"
                    textClassName="text-white"
                    size="medium"
                    href="/(tabs)/chat"
                    rounded="lg"
                />
            </View>
        </>
    );
};

const InfoChip = ({ icon, label }: { icon: IconName; label: string }) => (
    <View className="flex-row items-center mr-6 mb-2">
        <Icon name={icon} size={16} className="mr-2" />
        <ThemedText className="text-sm" selectable>{label}</ThemedText>
    </View>
);

const DetailRow = ({ label, value, isBold }: { label: string; value: string; isBold?: boolean }) => (
    <View className="flex-row justify-between gap-4 py-2 border-b border-neutral-200/50 dark:border-dark-primary/50">
        <ThemedText className="text-sm opacity-70">{label}</ThemedText>
        <ThemedText className={`text-sm text-right flex-1 ${isBold ? 'font-bold' : 'font-medium'}`} selectable>{value}</ThemedText>
    </View>
);

export default PropertyDetail;
