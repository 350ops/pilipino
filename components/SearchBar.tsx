import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import Animated from 'react-native-reanimated';

import Icon from './Icon';
import ThemedText from './ThemedText';

const SearchBar = () => {
    return (
        <View className="px-global bg-light-primary dark:bg-dark-primary w-full relative z-50">
            <Pressable onPress={() => router.push('/(tabs)/map')}>
                <Animated.View
                    sharedTransitionTag="searchBar"
                    style={{
                        elevation: 10,
                        height: 50,
                        shadowColor: '#000',
                        shadowOpacity: 0.18,
                        shadowRadius: 8,
                        shadowOffset: { width: 0, height: 0 },
                    }}
                    className="bg-light-primary flex-row items-center justify-center relative z-50 py-4 px-8 mt-3 mb-4 dark:bg-white/20 rounded-full"
                >
                    <Icon name="Search" size={16} strokeWidth={3} />
                    <ThemedText className="text-black dark:text-white font-medium ml-2">
                        Search foreclosure location
                    </ThemedText>
                </Animated.View>
            </Pressable>
        </View>
    );
};

export default SearchBar;
