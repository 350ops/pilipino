import React from 'react';
import { View } from 'react-native';

import AnimatedView from '@/components/AnimatedView';
import Header from '@/components/Header';
import Icon from '@/components/Icon';
import ThemeScroller from '@/components/ThemeScroller';
import ThemedText from '@/components/ThemedText';
import { useCollapsibleTitle } from '@/app/hooks/useCollapsibleTitle';

const inquiryStages = [
    {
        id: 'saved',
        title: 'Saved leads',
        description: 'Properties you want to review before contacting the source.',
        count: 0,
        icon: 'Bookmark',
    },
    {
        id: 'contacted',
        title: 'Contacted sources',
        description: 'Banks, government agencies, or brokers you have reached out to.',
        count: 0,
        icon: 'MessageCircle',
    },
    {
        id: 'due-diligence',
        title: 'Due diligence',
        description: 'Listings that need title, occupancy, access, or auction checks.',
        count: 0,
        icon: 'ClipboardCheck',
    },
] as const;

const InquiriesScreen = () => {
    const { scrollY, scrollHandler, scrollEventThrottle } = useCollapsibleTitle();

    return (
        <View className="flex-1 bg-light-primary dark:bg-dark-primary">
            <Header
                title="Inquiries"
                variant="collapsibleTitle"
                scrollY={scrollY}
            />
            <AnimatedView animation="scaleIn" className="flex-1">
                <ThemeScroller
                    className="pt-4"
                    onScroll={scrollHandler}
                    scrollEventThrottle={scrollEventThrottle}
                >
                    <ThemedText className="text-sm opacity-70 mb-6" selectable>
                        Track foreclosure leads as you review listings, contact sources, and prepare due diligence.
                    </ThemedText>

                    {inquiryStages.map((stage) => (
                        <View
                            key={stage.id}
                            className="w-full p-4 mb-4 flex-row items-center rounded-2xl bg-light-secondary dark:bg-dark-secondary"
                        >
                            <View className="w-12 h-12 rounded-xl bg-light-primary dark:bg-dark-primary items-center justify-center mr-4">
                                <Icon name={stage.icon} size={22} strokeWidth={1.7} />
                            </View>
                            <View className="flex-1">
                                <View className="flex-row items-center justify-between">
                                    <ThemedText className="text-base font-bold">{stage.title}</ThemedText>
                                    <ThemedText className="text-sm font-bold tabular-nums">{stage.count}</ThemedText>
                                </View>
                                <ThemedText className="text-xs opacity-70 mt-1" selectable>{stage.description}</ThemedText>
                            </View>
                        </View>
                    ))}
                </ThemeScroller>
            </AnimatedView>
        </View>
    );
};

export default InquiriesScreen;
