#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(BlobChannelModule, RCTEventEmitter)

RCT_EXTERN_METHOD(lanAddress:(RCTPromiseResolveBlock)resolve
                  withRejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(interfaceCandidates:(RCTPromiseResolveBlock)resolve
                  withRejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(serve:(NSDictionary *)options
                  resolve:(RCTPromiseResolveBlock)resolve
                  withRejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(release:(NSString *)requestId)

RCT_EXTERN_METHOD(abort:(NSString *)requestId)

RCT_EXTERN_METHOD(stream:(NSDictionary *)options
                  resolve:(RCTPromiseResolveBlock)resolve
                  withRejecter:(RCTPromiseRejectBlock)reject)

@end
