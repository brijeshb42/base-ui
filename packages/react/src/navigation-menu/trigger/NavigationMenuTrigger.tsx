  function handleOpenChange(
    nextOpen: boolean,
    eventDetails: NavigationMenuRoot.ChangeEventDetails,
  ) {
    const isHover = eventDetails.reason === REASONS.triggerHover;

    if (!interactionsEnabled) {
      return;
    }

    if (pointerType === 'touch' && isHover) {
      return;
    }

    if (!nextOpen && value !== itemValue) {
      return;
    }

    // Only allow "patient" clicks to close the popup if it's open.
    // If they clicked within 500ms of the popup opening, keep it open.
    if (isHover) {
      setStickIfOpen(true);
      stickIfOpenTimeout.clear();
      stickIfOpenTimeout.start(PATIENT_CLICK_THRESHOLD, () => {
        setStickIfOpen(false);
      });
    }

    if (nextOpen) {
      setValue(itemValue, eventDetails);
    } else {
      setValue(null, eventDetails);
      setPointerType('');
    }
  }
