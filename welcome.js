// welcome.js — extracted from welcome.html for strict CSP (no inline).
  function shareTrinityOne(e){
    e.preventDefault();
    var data={ title:'TrinityOne', text:'TrinityOne — read, gather, and share Scripture. Free, private, open source.', url: location.href };
    if(navigator.share){ navigator.share(data).catch(function(){}); return; }
    if(navigator.clipboard){ navigator.clipboard.writeText(data.url).catch(function(){}); }
    var lab=e.currentTarget.querySelector('.sc-label');
    if(lab){ var o=lab.textContent; lab.textContent='Link copied!'; setTimeout(function(){ lab.textContent=o; },1800); }
  }
  // strict-CSP: the inline onclick="shareTrinityOne(event)" is refused, so bind here instead
  var _shareBtn = document.getElementById('shareTrinityBtn');
  if (_shareBtn) _shareBtn.addEventListener('click', shareTrinityOne);
