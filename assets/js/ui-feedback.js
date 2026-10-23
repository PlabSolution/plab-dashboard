  // ── 알림(토스트)·확인 창 ──────────────────────────────────────────────
  // 예전엔 저장 실패·안내를 브라우저 alert(), 삭제 확인을 confirm()으로 띄워서 화면이 막히고
  // 모양도 제각각이었어요. 화면 오른쪽 아래에 잠깐 떴다 사라지는 알림과, 페이지 디자인에 맞춘
  // 확인 창으로 바꿨어요. 다른 스크립트보다 먼저 불러와서 어디서든 쓸 수 있어요.

  var UI_TOAST_DEFAULT_MS = 4000;

  function uiToaster(){
    var el = document.getElementById('ui-toaster');
    if(el) return el;
    el = document.createElement('div');
    el.id = 'ui-toaster';
    el.className = 'ui-toaster';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', '알림');
    document.body.appendChild(el);
    return el;
  }

  // type: 'success' | 'error' | 'warning' | 'info'
  // opts.action = { label, onClick } 이면 버튼(예: 되돌리기)을 같이 보여줘요.
  // opts.duration(ms) 동안 보이고, 오류는 조금 더 오래 둬요. 돌려주는 dismiss()로 직접 닫을 수도 있어요.
  function uiToast(message, opts){
    opts = opts || {};
    var type = opts.type || 'info';
    var toast = document.createElement('div');
    toast.className = 'ui-toast is-' + type;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    var icon = document.createElement('span');
    icon.className = 'ui-toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    toast.appendChild(icon);

    var text = document.createElement('div');
    text.className = 'ui-toast-text';
    text.textContent = message;
    toast.appendChild(text);

    var closed = false;
    function dismiss(){
      if(closed) return;
      closed = true;
      clearTimeout(timer);
      toast.classList.add('is-leaving');
      setTimeout(function(){ if(toast.parentNode) toast.parentNode.removeChild(toast); }, 180);
    }

    if(opts.action && opts.action.label){
      var actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'ui-toast-action';
      actionBtn.textContent = opts.action.label;
      actionBtn.addEventListener('click', function(){
        dismiss();
        if(typeof opts.action.onClick === 'function') opts.action.onClick();
      });
      toast.appendChild(actionBtn);
    }

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ui-toast-close';
    closeBtn.setAttribute('aria-label', '알림 닫기');
    closeBtn.addEventListener('click', dismiss);
    toast.appendChild(closeBtn);

    uiToaster().appendChild(toast);
    var duration = opts.duration || (type === 'error' ? 6000 : UI_TOAST_DEFAULT_MS);
    var timer = setTimeout(dismiss, duration);
    // 마우스를 올려두면 읽는 동안 사라지지 않게 해요.
    toast.addEventListener('mouseenter', function(){ clearTimeout(timer); });
    toast.addEventListener('mouseleave', function(){ if(!closed) timer = setTimeout(dismiss, 1500); });
    return { dismiss: dismiss };
  }

  // confirm() 대신 쓰는 확인 창. Promise<boolean>을 돌려줘요.
  // opts: { title, confirmLabel, cancelLabel, danger }
  function uiConfirm(message, opts){
    opts = opts || {};
    var dialog = document.getElementById('ui-confirm-dialog');
    if(!dialog){
      dialog = document.createElement('dialog');
      dialog.id = 'ui-confirm-dialog';
      dialog.className = 'ui-dialog';
      dialog.setAttribute('aria-labelledby', 'ui-confirm-title');
      dialog.setAttribute('aria-describedby', 'ui-confirm-message');
      dialog.innerHTML =
        '<form class="ui-dialog-body" method="dialog">' +
          '<div class="ui-dialog-header">' +
            '<h3 class="ui-dialog-title" id="ui-confirm-title"></h3>' +
            '<p class="ui-dialog-description" id="ui-confirm-message"></p>' +
          '</div>' +
          '<div class="ui-dialog-footer">' +
            '<button class="btn btn-ghost" type="button" data-ui-confirm="cancel"></button>' +
            '<button class="btn btn-primary" type="submit" data-ui-confirm="ok"></button>' +
          '</div>' +
        '</form>';
      document.body.appendChild(dialog);
    }
    if(typeof dialog.showModal !== 'function'){
      return Promise.resolve(window.confirm(message));
    }
    var okBtn = dialog.querySelector('[data-ui-confirm="ok"]');
    var cancelBtn = dialog.querySelector('[data-ui-confirm="cancel"]');
    var form = dialog.querySelector('form');
    dialog.querySelector('#ui-confirm-title').textContent = opts.title || '확인';
    dialog.querySelector('#ui-confirm-message').textContent = message;
    okBtn.textContent = opts.confirmLabel || '확인';
    cancelBtn.textContent = opts.cancelLabel || '취소';
    okBtn.classList.toggle('ui-btn-danger', !!opts.danger);

    return new Promise(function(resolve){
      function finish(value){
        form.removeEventListener('submit', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        dialog.removeEventListener('cancel', onCancel);
        if(dialog.open) dialog.close();
        resolve(value);
      }
      function onOk(e){ e.preventDefault(); finish(true); }
      function onCancel(e){ if(e) e.preventDefault(); finish(false); }
      form.addEventListener('submit', onOk);
      cancelBtn.addEventListener('click', onCancel);
      dialog.addEventListener('cancel', onCancel); // Esc 키
      dialog.showModal();
      // 되돌릴 수 없는 작업은 실수로 Enter를 눌러도 실행되지 않게 취소에 먼저 초점을 둬요.
      (opts.danger ? cancelBtn : okBtn).focus();
    });
  }
