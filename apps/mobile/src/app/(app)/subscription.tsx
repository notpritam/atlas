import { AdaptiveIcon as Ionicons } from '../../components/AdaptiveIcon.tsx';
import { Linking,ScrollView,StyleSheet,View } from 'react-native';
import { AdaptiveText as Text } from '../../components/AdaptiveText.tsx';
import { Button,Message,Screen } from '../../components/ui.tsx';
import { FrostedPanel } from '../../components/ScenicSurface.tsx';
import { ProcessingControls } from '../../billing/ProcessingControls.tsx';
import { useBilling } from '../../billing/BillingProvider.tsx';
import { useThemedStyles } from '../../appearance/AppearanceProvider.tsx';
import { colors,typography } from '../../theme.ts';

export default function Subscription(){
  const styles=useThemedStyles(baseStyles);
  const {plan,monthly,loading,busy,error,notice,purchase,restore,refresh}=useBilling();
  const active=plan?.subscriptions.filter(item=>item.active)||[];
  const appStore=active.find(item=>item.provider==='revenuecat');
  const web=active.some(item=>item.provider==='stripe');
  return <Screen top={false} bottom><ScrollView contentContainerStyle={styles.page}>
    <View style={styles.badge}><Ionicons name="sparkles-outline" size={20} color={colors.accent}/><Text style={styles.eyebrow}>FOUNDKEEP PRO</Text></View>
    <Text style={typography.title}>{plan?.pro?'A little more,\nalready yours.':'Keep the good things.\nWe’ll organize them.'}</Text>
    <Text style={typography.body}>Your collection is free. Pro adds managed processing for your saves, wherever you find them.</Text>
    <FrostedPanel>
      <Feature title="Less sorting, more finding" detail="Suggested tags, summaries, and connections between your saves."/>
      <Feature title="500 processing credits a month" detail="Choose what to process and keep control of your original content."/>
      <Feature title="2 GB for your collection" detail="One Pro account across the app, website, and browser extension."/>
    </FrostedPanel>
    {plan?.pro?<FrostedPanel><Text style={typography.heading}>Your Pro plan is active</Text><Text style={typography.small}>{appStore?`${appStore.renews?'Renews':'Available until'} ${new Date(appStore.expiresAt).toLocaleDateString()}.`:'Your web subscription includes Pro in this app.'}</Text>{appStore?<Button secondary label="Manage App Store subscription" onPress={()=>void Linking.openURL('https://apps.apple.com/account/subscriptions')}/>:null}{web?<Text style={typography.small}>Manage your existing web subscription in your Foundkeep dashboard.</Text>:null}</FrostedPanel>:<FrostedPanel>
      <Text style={typography.heading}>{monthly?`${monthly.product.priceString} / month`:'Pro is coming soon'}</Text>
      <Text style={typography.small}>{monthly?'Monthly subscription. Cancel anytime in your Apple Account settings.':'You can keep saving, importing, and connecting your own agent for free.'}</Text>
      <Button label={monthly?`Subscribe · ${monthly.product.priceString}/month`:'Subscription unavailable'} loading={busy} disabled={!monthly || loading || !plan?.billing.revenuecat.available} onPress={()=>void purchase()}/>
    </FrostedPanel>}
    <ProcessingControls key={plan?.billing.revenuecat.appUserId || 'loading'} />
    <Message>{notice}</Message><Message error>{error}</Message>
    <Button secondary label="Restore purchases" loading={busy} disabled={!plan?.billing.revenuecat.available || loading} onPress={()=>void restore()}/>
    <Button secondary label="Refresh subscription" loading={loading} disabled={busy} onPress={()=>void refresh()}/>
    <Text style={typography.small}>Free includes your library, bookmark imports, and access for your own agent through MCP. Pro processing is optional and never replaces your personal notes or tags.</Text>
    {monthly&&!plan?.pro?<Text style={styles.legal}>Payment is charged to your Apple Account when you confirm. Your subscription renews monthly unless cancelled at least 24 hours before the current period ends. Manage or cancel it in your Apple Account settings.</Text>:null}
    <View style={styles.links}><Text accessibilityRole="link" style={styles.link} onPress={()=>void Linking.openURL('https://foundkeep.app/terms')}>Terms of Use</Text><Text accessibilityRole="link" style={styles.link} onPress={()=>void Linking.openURL('https://foundkeep.app/privacy')}>Privacy Policy</Text></View>
  </ScrollView></Screen>;
}
function Feature({title,detail}:{title:string;detail:string}){const styles=useThemedStyles(baseStyles);return <View style={styles.feature}><Ionicons name="checkmark-circle-outline" size={21} color={colors.accent}/><View style={{flex:1,gap:4}}><Text style={typography.label}>{title}</Text><Text style={typography.small}>{detail}</Text></View></View>;}
const baseStyles=StyleSheet.create({page:{padding:24,gap:22,paddingBottom:36},badge:{flexDirection:'row',alignItems:'center',gap:9,marginTop:8},eyebrow:{fontSize:12,fontWeight:'700',letterSpacing:1.5,color:colors.accent},feature:{flexDirection:'row',gap:12,paddingVertical:10},legal:{...typography.small,fontSize:12,lineHeight:18},links:{flexDirection:'row',justifyContent:'center',gap:24},link:{...typography.small,textDecorationLine:'underline',color:colors.ink}});
