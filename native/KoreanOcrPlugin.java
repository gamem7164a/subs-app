package com.mysubs.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions;

@CapacitorPlugin(name = "KoreanOcr")
public class KoreanOcrPlugin extends Plugin {

    @PluginMethod
    public void recognize(final PluginCall call) {
        String b64 = call.getString("base64");
        if (b64 == null) {
            call.reject("no_image");
            return;
        }
        int comma = b64.indexOf(',');
        if (comma >= 0) b64 = b64.substring(comma + 1);
        byte[] bytes;
        try {
            bytes = Base64.decode(b64, Base64.DEFAULT);
        } catch (Exception e) {
            call.reject("bad_base64");
            return;
        }
        Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (bmp == null) {
            call.reject("decode_failed");
            return;
        }
        InputImage image = InputImage.fromBitmap(bmp, 0);
        final TextRecognizer recognizer = TextRecognition.getClient(new KoreanTextRecognizerOptions.Builder().build());
        recognizer.process(image)
            .addOnSuccessListener(result -> {
                JSArray lines = new JSArray();
                for (Text.TextBlock block : result.getTextBlocks()) {
                    for (Text.Line line : block.getLines()) {
                        Rect box = line.getBoundingBox();
                        if (box == null) continue;
                        JSObject o = new JSObject();
                        o.put("text", line.getText());
                        o.put("left", box.left);
                        o.put("top", box.top);
                        o.put("bottom", box.bottom);
                        lines.put(o);
                    }
                }
                JSObject ret = new JSObject();
                ret.put("lines", lines);
                call.resolve(ret);
                recognizer.close();
            })
            .addOnFailureListener(e -> {
                call.reject("ocr_failed: " + e.getMessage());
                recognizer.close();
            });
    }
}
