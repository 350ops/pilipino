import React, { useState } from 'react';
import Header, { HeaderIcon } from '@/components/Header';
import useThemeColors from '@/app/contexts/ThemeColors';
import ThemedScroller from '@/components/ThemeScroller';
import AniamatedView from '@/components/AnimatedView';
import ThemedText from '@/components/ThemedText';
import { Image, Pressable, View } from 'react-native';
import { Chip } from '@/components/Chip';
import { router } from 'expo-router';
import { useForeclosures } from '@/app/hooks/useForeclosures';
import { normalizePropertyType } from '@/lib/foreclosures';

const ForeclosureListings = () => {
    const { properties, loading, formatPrice } = useForeclosures();
    const [selectedType, setSelectedType] = useState('All');

    const filteredProperties = selectedType === 'All' 
        ? properties 
        : properties.filter(p => p.type === selectedType || p.source === selectedType || p.status === selectedType);

    const filterTypes = ['All', ...Array.from(new Set(properties.flatMap((property) => [property.source, property.type, property.status]).filter(Boolean))).slice(0, 12)];

    return (
        <AniamatedView animation="scaleIn" className="flex-1">
            <Header
                title=" "
                rightComponents={[<HeaderIcon icon="Search" href="/screens/map" />]}
            />
            <ThemedScroller
                className="flex-1 pt-8"
                keyboardShouldPersistTaps="handled"
            >
                <ThemedText className='text-3xl font-semibold'>Foreclosures</ThemedText>
                
                <View className="flex-row gap-2 mt-4 mb-6">
                    <ThemedScroller horizontal showsHorizontalScrollIndicator={false} className="flex-row gap-2">
                        {filterTypes.map((type) => (
                            <Chip 
                                key={type}
                                isSelected={selectedType === type} 
                                size="lg" 
                                label={type} 
                                onPress={() => setSelectedType(type)}
                            />
                        ))}
                    </ThemedScroller>
                </View>

                {!loading && filteredProperties.map((property) => (
                    <ListingCard 
                        key={property.id}
                        title={property.title} 
                        description={`${property.location} • ${formatPrice(property.price)}`} 
                        image={{ uri: property.image }} 
                        source={property.source}
                        type={normalizePropertyType(property.type)}
                        id={property.id}
                    />
                ))}

                {loading && (
                    <View className="py-20 items-center justify-center">
                        <ThemedText>Loading foreclosures...</ThemedText>
                    </View>
                )}
            </ThemedScroller>
          
        </AniamatedView>
    );
};

const ListingCard = (props: any) => {
    return (
        <Pressable onPress={() => router.push(`/screens/product-detail?id=${props.id}`)} className="flex-row gap-2 items-center mb-5">
            <Image className='w-24 h-24 rounded-2xl mr-3' source={props.image} />
            <View className="flex-1">
                <ThemedText className='text-base font-semibold' numberOfLines={1}>{props.title}</ThemedText>
                <ThemedText className='font-light mt-1 text-sm' numberOfLines={2}>{props.description}</ThemedText>
                <View className="flex-row flex-wrap gap-2 mt-2">
                    <View className="bg-light-primary/10 dark:bg-dark-primary/20 self-start px-2 py-0.5 rounded-md">
                        <ThemedText className="text-[10px] font-bold text-light-primary dark:text-dark-primary">{props.source}</ThemedText>
                    </View>
                    <View className="bg-light-secondary dark:bg-dark-secondary self-start px-2 py-0.5 rounded-md">
                        <ThemedText className="text-[10px] font-bold">{props.type}</ThemedText>
                    </View>
                </View>
            </View>
        </Pressable>
    );
};

export default ForeclosureListings;
