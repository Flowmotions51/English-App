package com.englishapp.repository;

import com.englishapp.model.AiCheckCache;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface AiCheckCacheRepository extends JpaRepository<AiCheckCache, Long> {
    Optional<AiCheckCache> findByCacheKey(String cacheKey);
}
