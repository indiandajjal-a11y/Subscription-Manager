package com.isp.common.dto;

import java.time.Instant;

public record ApiResponse<T>(
        T data,
        String correlationId,
        Instant timestamp
) {
    public static <T> ApiResponse<T> of(T data, String correlationId) {
        return new ApiResponse<>(data, correlationId, Instant.now());
    }
}
