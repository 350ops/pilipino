import Header, { HeaderIcon } from '@/components/Header';
import ThemeScroller from '@/components/ThemeScroller';
import React, { useRef, useEffect, useContext } from 'react';
import { View, Text, Pressable, Image, Animated } from 'react-native';
import Section from '@/components/layout/Section';
import { CardScroller } from '@/components/CardScroller';
import Card from '@/components/Card';
import AnimatedView from '@/components/AnimatedView';
import { ScrollContext } from './_layout';
import ThemedText from '@/components/ThemedText';
import { shadowPresets } from '@/utils/useShadow';
import { router } from 'expo-router';
import { useForeclosures } from '@/app/hooks/useForeclosures';
import { normalizePropertyType } from '@/lib/foreclosures';

const HomeScreen = () => {
    const scrollY = useContext(ScrollContext);
    const { properties, loading, formatPrice } = useForeclosures();

    // Group properties by source or location for sections
    const sources = [...new Set(properties.map(p => p.source))];
    const locationGroups = [
        { title: "Metro Manila Deals", filter: (p: any) => p.location.includes("Metro Manila") || p.location.includes("City") },
        { title: "Provincial Listings", filter: (p: any) => !p.location.includes("Metro Manila") && !p.location.includes("City") },
        { title: "Bank Foreclosed (BDO/BPI)", filter: (p: any) => p.source === "BDO" || p.source === "BPI" },
        { title: "Government Assets (Pag-IBIG)", filter: (p: any) => p.source === "Pag-IBIG" }
    ];

    return (
        <ThemeScroller
            onScroll={Animated.event(
                [{ nativeEvent: { contentOffset: { y: scrollY } } }],
                { useNativeDriver: false }
            )}
            scrollEventThrottle={16}
        >
            <AnimatedView animation="scaleIn" className='flex-1 mt-4'>
                <Pressable onPress={() => router.push('/screens/map')} style={{ ...shadowPresets.large }} className='p-5 mb-8 flex flex-row items-center rounded-2xl bg-light-primary dark:bg-dark-secondary'>
                    <View className='flex-1 pr-2'>
                        <ThemedText className='text-lg font-bold'>
                            Find your next home
                        </ThemedText>
                        <ThemedText className='text-sm font-medium opacity-70'>
                            Explore 1,000+ foreclosed properties across the Philippines
                        </ThemedText>
                    </View>
                    <View className='w-20 h-20 relative'>
                        <View className='w-full h-full rounded-xl relative z-20 overflow-hidden border-2 border-light-primary dark:border-dark-primary'>
                            <Image className='w-full h-full' source={{ uri: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?q=80&w=400' }} />
                        </View>
                        <View className='w-full h-full absolute top-0 left-1 rotate-12 rounded-xl overflow-hidden border-2 border-light-primary dark:border-dark-primary'>
                            <Image className='w-full h-full' source={{ uri: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?q=80&w=400' }} />
                        </View>
                    </View>
                </Pressable>

                {!loading && locationGroups.map((section, index) => {
                    const filteredProps = properties.filter(section.filter);
                    if (filteredProps.length === 0) return null;

                    return (
                        <Section
                            key={`section-${index}`}
                            title={section.title}
                            titleSize="lg"
                            link="/(tabs)/listings"
                            linkText="View all"
                        >
                            <CardScroller space={15} className='mt-1.5 pb-4'>
                                {filteredProps.map((property) => (
                                    <Card
                                        key={property.id}
                                        title={property.title}
                                        description={`${property.location} • ${property.source}`}
                                        rounded="2xl"
                                        hasFavorite
                                        badge={normalizePropertyType(property.type)}
                                        href={`/screens/product-detail?id=${property.id}`}
                                        price={formatPrice(property.price)}
                                        width={240}
                                        imageHeight={160}
                                        image={property.image}
                                    />
                                ))}
                            </CardScroller>
                        </Section>
                    );
                })}

                {loading && (
                    <View className="py-20 items-center justify-center">
                        <ThemedText>Loading foreclosure listings...</ThemedText>
                    </View>
                )}

            </AnimatedView>
        </ThemeScroller>
    );
}

export default HomeScreen;
