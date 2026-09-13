// Publish URLs only after verifying their signed artifact or store testing state.
type Distribution={ios:{url:string|null;status:string};android:{apkUrl:string|null;playUrl:string|null;status:string}};
export const betaDistribution:Record<'prod'|'dev',Distribution>={
 prod:{ios:{url:null,status:'Build 21 is ready for internal TestFlight testing. External friend access is waiting for tester setup and beta review submission.'},android:{apkUrl:'https://foundkeep.app/downloads/foundkeep-android-1.0.0-5.apk',playUrl:null,status:'FoundKeep 1.0.0 (build 5) is available as a signed APK.'}},
 dev:{ios:{url:null,status:'Your private dev build is being prepared.'},android:{apkUrl:null,playUrl:null,status:'Your private dev Android build is being prepared.'}},
};
