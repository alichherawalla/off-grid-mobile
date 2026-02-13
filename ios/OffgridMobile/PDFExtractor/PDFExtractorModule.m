#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PDFExtractorModule, NSObject)

RCT_EXTERN_METHOD(extractText:(NSString *)filePath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
