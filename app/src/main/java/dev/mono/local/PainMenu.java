package dev.mono.local;
import android.app.Dialog;
import android.content.*;
import android.view.View;
import android.widget.LinearLayout;
import java.util.*;

/** PAIN-styled choices shared by library, audio, sync and appearance. */
final class PainMenu {
 private final Context context;private CharSequence title="",message;private View view;private String[] items;private DialogInterface.OnClickListener select;private int checked=-1;
 private final List<CharSequence> buttons=new ArrayList<>();private final List<DialogInterface.OnClickListener> clicks=new ArrayList<>();private final List<Integer> which=new ArrayList<>();
 PainMenu(Context context){this.context=context;}
 PainMenu setTitle(CharSequence title){this.title=title;return this;}
 PainMenu setMessage(CharSequence message){this.message=message;return this;}
 PainMenu setView(View view){this.view=view;return this;}
 PainMenu setItems(String[] items,DialogInterface.OnClickListener click){this.items=items;select=click;return this;}
 PainMenu setSingleChoiceItems(String[] items,int checked,DialogInterface.OnClickListener click){this.checked=checked;return setItems(items,click);}
 PainMenu setPositiveButton(CharSequence label,DialogInterface.OnClickListener click){return button(label,click,DialogInterface.BUTTON_POSITIVE);}
 PainMenu setNegativeButton(CharSequence label,DialogInterface.OnClickListener click){return button(label,click,DialogInterface.BUTTON_NEGATIVE);}
 PainMenu setNeutralButton(CharSequence label,DialogInterface.OnClickListener click){return button(label,click,DialogInterface.BUTTON_NEUTRAL);}
 private PainMenu button(CharSequence label,DialogInterface.OnClickListener click,int id){buttons.add(label);clicks.add(click);which.add(id);return this;}
 Dialog show(){
  MobilePalette palette=new MobilePalette((MonoApp)context.getApplicationContext());
  AppSheet sheet=new AppSheet(context,title.toString(),palette.paper,palette.ink,palette.dark);
  if(message!=null)sheet.text(message.toString(),15);if(view!=null)sheet.content.addView(view,new LinearLayout.LayoutParams(-1,-2));
  if(items!=null)for(int i=0;i<items.length;i++){final int index=i;sheet.button((checked==i?"✓  ":"")+items[i],null,()->{if(select!=null)select.onClick(sheet.dialog,index);});}
  for(int i=0;i<buttons.size();i++){final int index=i;sheet.button(buttons.get(i).toString(),null,()->{if(clicks.get(index)!=null)clicks.get(index).onClick(sheet.dialog,which.get(index));});}
  sheet.show();return sheet.dialog;
 }
}
