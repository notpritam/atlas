import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { configureEnvironment } from './src/environment.ts';
configureEnvironment(Constants.expoConfig?.extra?.foundkeep, Platform.OS);
// Router and native adapters must load after the trusted environment is installed.
require('expo-router/entry');
