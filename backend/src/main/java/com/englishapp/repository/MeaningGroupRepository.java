package com.englishapp.repository;


import com.englishapp.model.MeaningGroup;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface MeaningGroupRepository extends JpaRepository<MeaningGroup, Long> {

    @Query("select m from MeaningGroup m where m.user.id = :userId order by m.createdAt desc")
    List<MeaningGroup> findAllByUserId(@Param("userId") Long userId);

    @Query("select m from MeaningGroup m where m.id = :groupId and m.user.id = :userId")
    Optional<MeaningGroup> findByIdAndUser(@Param("groupId") Long groupId, @Param("userId") Long userId);
}
