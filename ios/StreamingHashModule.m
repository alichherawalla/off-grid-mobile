#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(StreamingHashModule, NSObject)

RCT_EXTERN_METHOD(sha512:(NSString *)path
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
