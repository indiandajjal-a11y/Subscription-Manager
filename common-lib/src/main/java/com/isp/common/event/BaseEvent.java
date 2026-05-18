package com.isp.common.event;

import java.time.Instant;
import java.util.UUID;

public record BaseEvent(
        UUID eventId,
        String eventType,
        UUID correlationId,
        Instant timestamp
) implements DomainEvent {
    public static BaseEvent create(String eventType, UUID correlationId) {
        return new BaseEvent(UUID.randomUUID(), eventType, correlationId, Instant.now());
    }
}
