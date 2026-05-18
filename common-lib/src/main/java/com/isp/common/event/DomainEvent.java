package com.isp.common.event;

import java.time.Instant;
import java.util.UUID;

public interface DomainEvent {
    UUID eventId();

    String eventType();

    UUID correlationId();

    Instant timestamp();
}
