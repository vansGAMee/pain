package dev.mono.local;

import android.animation.ValueAnimator;
import android.view.MotionEvent;
import android.view.View;
import android.view.animation.PathInterpolator;

/** Small, interruptible feedback. Never changes layout or consumes a gesture. */
final class MicroMotion {
  static final PathInterpolator EASE = new PathInterpolator(.2f, 0f, 0f, 1f);

  static boolean enabled(View view) {
    return ValueAnimator.areAnimatorsEnabled()
        && ((MonoApp) view.getContext().getApplicationContext()).prefs.getBoolean("motion", true);
  }

  static void reset(View visual) {
    visual.animate().cancel();
    visual.setScaleX(1f);
    visual.setScaleY(1f);
  }

  static void press(View target, View visual, float amount) {
    target.setOnTouchListener((v, event) -> {
      switch (event.getActionMasked()) {
        case MotionEvent.ACTION_DOWN:
          if (enabled(visual)) {
            visual.animate().cancel();
            visual.animate().scaleX(amount).scaleY(amount).setDuration(85)
                .setInterpolator(EASE).start();
          } else reset(visual);
          break;
        case MotionEvent.ACTION_UP:
        case MotionEvent.ACTION_CANCEL:
          if (enabled(visual)) {
            visual.animate().cancel();
            visual.animate().scaleX(1f).scaleY(1f).setDuration(210)
                .setInterpolator(EASE).start();
          } else reset(visual);
          break;
      }
      return false;
    });
    target.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener() {
      public void onViewAttachedToWindow(View v) {}
      public void onViewDetachedFromWindow(View v) { reset(visual); }
    });
  }
}
